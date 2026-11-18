/* POST /v1/convert  - used by other BINI systems.
   Authorization: Bearer <system key>
   X-Timestamp:   <unix seconds>, within 5 minutes of the server clock
   X-Signature:   hex HMAC-SHA256 over  "<X-Timestamp>." + <raw request body>,  using the key's signing secret
   Body: multipart/form-data with  file (required), quality 10-100 (default 75), mode lossy|lossless, aspect original|16:9|9:16|1:1 */
const express = require('express');
const Busboy = require('busboy');
const db = require('./db');
const cfg = require('./config');
const { HttpError } = require('./errors');
const { sha256, hmac, safeEqual, signingSecretFor, publicId } = require('./crypto');
const { consume } = require('./ratelimit');
const { nextId } = require('./ids');
const activity = require('./activity');
const settings = require('./settings');
const imaging = require('./imaging');
const files = require('./files');

const router = express.Router();
const ASPECTS = ['original', '16:9', '9:16', '1:1'];
const MODES = ['lossy', 'lossless'];

function unauthorized(msg) { return new HttpError(401, 'UNAUTHORIZED', msg || 'Bad key, bad signature or expired timestamp.'); }

// Step 1: key, timestamp and rate limit are checked before the body is read, so bad callers cost almost nothing.
async function identify(req, res, next) {
  try {
    if (!consume('ip:' + req.ip, 300, 60000)) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests.');
    const m = /^Bearer ([0-9a-f]{8})\.([0-9a-f]{64})$/.exec(req.headers.authorization || '');
    if (!m) throw unauthorized();
    const r = await db.query(
      `SELECT k.id AS key_row, k.key_hash, k.expires_at, s.id AS system_id, s.code, s.status
         FROM api_keys k JOIN systems s ON s.id = k.system_id
        WHERE k.key_id = $1 AND k.revoked_at IS NULL`, [m[1]]);
    const k = r.rows[0];
    if (!k || !safeEqual(sha256(m[2]), k.key_hash) || new Date(k.expires_at) < new Date() || k.status !== 'Active') throw unauthorized();

    const ts = String(req.headers['x-timestamp'] || '');
    if (!/^\d{9,11}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > cfg.timestampWindowSeconds) throw unauthorized('Expired or missing timestamp.');
    if (!/^[0-9a-f]{64}$/.test(String(req.headers['x-signature'] || ''))) throw unauthorized('Missing signature.');

    if (!consume('sys:' + k.code, cfg.apiRatePerMin, 60000)) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests from this system.');
    req.system = { id: k.system_id, code: k.code, keyId: m[1], timestamp: ts, signature: req.headers['x-signature'] };
    next();
  } catch (e) { next(e); }
}

// Step 2: read the raw body, up to the size limit plus a little for the multipart envelope.
async function readBody(req, res, next) {
  try {
    const s = await settings.get();
    req.limits = s;
    express.raw({ type: function () { return true; }, limit: (s.maxMb + 1) * 1048576 })(req, res, function (err) {
      if (err && err.type === 'entity.too.large') return next(new HttpError(413, 'TOO_LARGE', 'File larger than ' + s.maxMb + ' MB.'));
      next(err);
    });
  } catch (e) { next(e); }
}

// Step 3: the signature must match, and the same signature can only be used once.
async function verifySignature(req, res, next) {
  try {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const want = hmac(signingSecretFor(req.system.keyId), req.system.timestamp + '.', body);
    if (!safeEqual(want, req.system.signature)) throw unauthorized();
    const ins = await db.query(
      "INSERT INTO used_signatures (signature, expires_at) VALUES ($1, now() + interval '10 minutes') ON CONFLICT DO NOTHING RETURNING signature",
      [req.system.signature]);
    if (!ins.rowCount) throw unauthorized('This request was already used.');
    req.rawBody = body;
    next();
  } catch (e) { next(e); }
}

function parseMultipart(req, body, maxBytes) {
  return new Promise(function (resolve, reject) {
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes, fields: 10, fieldSize: 256, parts: 12 } }); }
    catch (e) { return reject(new HttpError(400, 'BAD_REQUEST', 'Send the image as multipart/form-data.')); }
    const out = { fields: {}, file: null, tooBig: false, extraFiles: false };
    bb.on('field', function (name, v) { out.fields[name] = v; });
    bb.on('file', function (name, stream) {
      if (name !== 'file' || out.file) { stream.resume(); return; }
      const chunks = [];
      stream.on('data', function (d) { chunks.push(d); });
      stream.on('limit', function () { out.tooBig = true; });
      stream.on('end', function () { out.file = Buffer.concat(chunks); });
    });
    bb.on('filesLimit', function () { out.extraFiles = true; });
    bb.on('error', function () { reject(new HttpError(400, 'BAD_REQUEST', 'The request body could not be read.')); });
    bb.on('close', function () { resolve(out); });
    bb.end(body);
  });
}

async function record(req, detail, result, size, ref) {
  await activity.log(db, { actor: req.system.code, kind: 'System', detail: detail, size: size, result: result, ref: ref });
}

router.post('/v1/convert', identify, readBody, verifySignature, async function (req, res, next) {
  try {
    const lim = req.limits, maxBytes = lim.maxMb * 1048576;
    const reject = async function (status, code, message, why) {
      await record(req, '1 image', 'Rejected: ' + why);
      throw new HttpError(status, code, message);
    };

    const form = await parseMultipart(req, req.rawBody, maxBytes);
    if (form.tooBig) return await reject(413, 'TOO_LARGE', 'File larger than ' + lim.maxMb + ' MB.', 'file size');
    if (!form.file || !form.file.length) return await reject(400, 'BAD_REQUEST', 'Field "file" is required.', 'missing file');
    if (form.extraFiles) return await reject(400, 'BAD_REQUEST', 'Send one file per request.', 'invalid parameter');

    const f = form.fields;
    const quality = f.quality === undefined || f.quality === '' ? 75 : Number(f.quality);
    const mode = f.mode === undefined || f.mode === '' ? 'lossy' : f.mode;
    const aspect = f.aspect === undefined || f.aspect === '' ? 'original' : f.aspect;
    if (!Number.isInteger(quality) || quality < 10 || quality > 100) return await reject(400, 'BAD_REQUEST', 'quality must be a whole number from 10 to 100.', 'invalid parameter');
    if (MODES.indexOf(mode) < 0) return await reject(400, 'BAD_REQUEST', 'mode must be lossy or lossless.', 'invalid parameter');
    if (ASPECTS.indexOf(aspect) < 0) return await reject(400, 'BAD_REQUEST', 'aspect must be original, 16:9, 9:16 or 1:1.', 'invalid parameter');

    if (!imaging.detect(form.file)) return await reject(415, 'BAD_IMAGE', 'File content is not an allowed image type.', 'file type');

    let out;
    try { out = await imaging.convert(form.file, { quality: quality, mode: mode, aspect: aspect }); }
    catch (e) {
      if (e instanceof HttpError) return await reject(e.status, e.code, e.message, e.status === 413 ? 'file size' : e.status === 415 ? 'file type' : 'timeout');
      throw e;
    }

    const pid = publicId();
    await files.save(pid, out.data);
    const lnk = files.link(pid);
    const imgId = await db.tx(async function (c) {
      const id = await nextId(c, 'IMG');
      await c.query(
        'INSERT INTO conversions (public_id, composite_id, system_id, bytes_in, bytes_out, quality, mode, aspect) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [pid, id, req.system.id, form.file.length, out.data.length, quality, mode, aspect]);
      await activity.log(c, { actor: req.system.code, kind: 'System', detail: '1 image', size: activity.mb(form.file.length) + ' to ' + activity.mb(out.data.length), result: 'Success', ref: id });
      return id;
    });

    res.set('Cache-Control', 'no-store').json({
      system: 'WPC', type: 'IMG', id: imgId, requested_by: req.system.code,
      format: 'webp', bytes_in: form.file.length, bytes_out: out.data.length,
      url: lnk.url, expires_at: lnk.expiresAt
    });
  } catch (e) { next(e); }
});

module.exports = router;
