/* Image handling for the API. Same output rules as the browser tool: metadata removed, same quality scale.
   Never trusts the extension or the declared type: checks the real file signature, then decodes and re-encodes. */
const sharp = require('sharp');
const cfg = require('./config');
const { HttpError } = require('./errors');

sharp.cache(false);

function ascii(u8, from, to) {
  let s = '';
  for (let i = from; i < to && i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return s;
}

// Returns 'png' | 'jpg' | 'gif' | 'bmp' | 'webp' | 'avif', or null when the content is not an allowed image.
function detect(buf) {
  const u8 = buf.subarray(0, 32);
  if (u8.length >= 8 && u8[0] === 0x89 && ascii(u8, 1, 4) === 'PNG' && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return 'png';
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'jpg';
  const g = ascii(u8, 0, 6);
  if (g === 'GIF87a' || g === 'GIF89a') return 'gif';
  if (ascii(u8, 0, 2) === 'BM') return 'bmp';
  if (ascii(u8, 0, 4) === 'RIFF' && ascii(u8, 8, 12) === 'WEBP') return 'webp';
  if (ascii(u8, 4, 8) === 'ftyp') {
    const brands = ascii(u8, 8, 32);
    if (brands.indexOf('avif') > -1 || brands.indexOf('avis') > -1) return 'avif';
  }
  return null;
}


/* libvips cannot read BMP, so uncompressed BMP (1/4/8/24/32 bit) is decoded here into raw pixels.
   Compressed BMP variants are refused as damaged/unsupported. Returns { data, info } for sharp's raw input. */
function decodeBmp(buf, maxPixels) {
  const bad = function () { throw new Error('bad bmp'); };
  if (buf.length < 54) bad();
  const off = buf.readUInt32LE(10), hdr = buf.readUInt32LE(14);
  if (hdr < 40) bad();
  const w = buf.readInt32LE(18); let h = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28), comp = buf.readUInt32LE(30);
  const topDown = h < 0; h = Math.abs(h);
  if (w <= 0 || h <= 0 || w * h > maxPixels) throw new Error('Input image exceeds pixel limit');
  if (comp !== 0 || [1, 4, 8, 24, 32].indexOf(bpp) < 0) bad();
  const stride = Math.floor((w * bpp + 31) / 32) * 4;
  if (off + stride * h > buf.length) bad();
  let pal = null;
  if (bpp <= 8) {
    const n = buf.readUInt32LE(46) || (1 << bpp), po = 14 + hdr; pal = [];
    if (po + n * 4 > buf.length) bad();
    for (let i = 0; i < n; i++) pal.push([buf[po + i * 4 + 2], buf[po + i * 4 + 1], buf[po + i * 4]]);
  }
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      let r, g, b, a = 255;
      if (bpp === 24) { b = buf[row + x * 3]; g = buf[row + x * 3 + 1]; r = buf[row + x * 3 + 2]; }
      else if (bpp === 32) { b = buf[row + x * 4]; g = buf[row + x * 4 + 1]; r = buf[row + x * 4 + 2]; }
      else {
        const per = 8 / bpp, byte = buf[row + Math.floor(x / per)];
        const idx = (byte >> (8 - bpp * ((x % per) + 1))) & ((1 << bpp) - 1);
        const c = pal[idx] || bad(); r = c[0]; g = c[1]; b = c[2];
      }
      const o = (y * w + x) * 4; out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return { data: out, info: { width: w, height: h, channels: 4 } };
}

/* At most CONVERT_CONCURRENCY conversions run at once, so memory use stays bounded. */
const waiting = [];
let active = 0;
async function slot(fn) {
  if (active >= cfg.convertConcurrency) await new Promise(function (r) { waiting.push(r); });
  active++;
  try { return await fn(); }
  finally { active--; const next = waiting.shift(); if (next) next(); }
}

// opts: { quality 10-100, mode 'lossy'|'lossless', aspect 'original'|'16:9'|'9:16'|'1:1' }
// Resolves { data: Buffer, width, height }.
function convert(buf, opts) {
  return slot(async function () {
    const base = { limitInputPixels: cfg.maxPixels, failOn: 'error' };
    try {
      if (detect(buf) === 'bmp') { const d = decodeBmp(buf, cfg.maxPixels); buf = d.data; base.raw = d.info; }
      const meta = await sharp(buf, base).metadata();
      let w = meta.width, h = meta.height;
      if (!w || !h) throw new Error('no size');
      if (meta.orientation && meta.orientation >= 5) { const t = w; w = h; h = t; } // after auto-rotate

      let pipe = sharp(buf, base).timeout({ seconds: cfg.convertTimeoutSeconds }).rotate(); // rotate() applies the EXIF orientation
      if (opts.aspect !== 'original') {
        const p = opts.aspect.split(':'), r = Number(p[0]) / Number(p[1]);
        let sw = w, sh = h;
        if (w / h > r) sw = Math.round(h * r); else sh = Math.round(w / r);
        pipe = pipe.extract({ left: Math.round((w - sw) / 2), top: Math.round((h - sh) / 2), width: sw, height: sh }); // centred crop
      }
      // Metadata (location, device data, EXIF, ICC) is dropped because sharp writes none unless asked to.
      const out = await pipe.webp({ quality: opts.quality, lossless: opts.mode === 'lossless', effort: 4 }).toBuffer({ resolveWithObject: true });
      return { data: out.data, width: out.info.width, height: out.info.height };
    } catch (e) {
      const msg = String(e && e.message);
      if (/pixel limit/i.test(msg)) throw new HttpError(413, 'TOO_LARGE', 'Image has too many pixels to process.');
      if (/time ?out|timed out/i.test(msg)) throw new HttpError(504, 'TIMEOUT', 'Conversion took too long.');
      throw new HttpError(415, 'BAD_IMAGE', 'File content is not an allowed image type.');
    }
  });
}

module.exports = { detect, convert };
