/* End-to-end tests against a real PostgreSQL database and the real HTTP server.
   Needs an empty test database. Example:
     TEST_DATABASE_URL=postgres://user:pass@localhost:5432/wpc_test npm test
   WARNING: this wipes the "public" schema of that database. Never point it at real data. */
const PORT = 3099;
process.env.NODE_ENV = 'test';
process.env.PORT = String(PORT);
process.env.PUBLIC_URL = 'http://127.0.0.1:' + PORT;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres:///wpc_test?host=/tmp&port=5433&user=postgres';
process.env.MASTER_SECRET = 'test-master-secret-' + 'x'.repeat(40);
process.env.DEV_LOGIN = 'true';
process.env.API_RATE_PER_MIN = '1000';
process.env.STORAGE_DIR = require('path').join(require('os').tmpdir(), 'wpc-test-out-' + process.pid);

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../src/db');
const crypto_ = require('../src/crypto');
const pin = require('../src/pin');
const cfg = require('../src/config');
const jobs = require('../src/jobs');
const files = require('../src/files');
const { migrate } = require('../scripts/migrate');
const { createApp } = require('../src/server');
const client = require('../examples/call-api');

const BASE = process.env.PUBLIC_URL;
let passed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failures.push(name); console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'values differ') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }
function ok(c, msg) { if (!c) throw new Error(msg || 'condition is false'); }

async function req(method, p, o) {
  o = o || {};
  const headers = Object.assign({}, o.headers || {});
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.origin !== false && method !== 'GET') headers.Origin = BASE;
  let body;
  if (o.body !== undefined) { body = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + p, { method: method, headers: headers, body: body, redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, headers: r.headers, text: text, json: json };
}
function cookieOf(r) {
  const c = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).find(function (x) { return x.startsWith('bini_sid='); });
  return c ? c.split(';')[0] : null;
}
async function login(email) {
  const r = await req('GET', '/auth/dev-login?email=' + encodeURIComponent(email));
  return { status: r.status, cookie: cookieOf(r) };
}
function chunks(buf) { // RIFF chunk names inside a WebP file
  const out = []; let i = 12;
  while (i + 8 <= buf.length) { out.push(buf.toString('ascii', i, i + 4)); i += 8 + buf.readUInt32LE(i + 4) + (buf.readUInt32LE(i + 4) % 2); }
  return out;
}

async function sample(w, h, fmt, exif, orientation) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + (i >> 5) * 13) % 251;
  let s = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  if (exif) s = s.withExif(exif);
  if (orientation) s = s.withMetadata({ orientation: orientation });
  return fmt === 'png' ? s.png().toBuffer() : s.jpeg({ quality: 92 }).toBuffer();
}

async function main() {
  // clean database
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const app = createApp();
  const server = await new Promise(function (res) { const s = app.listen(PORT, function () { res(s); }); });

  const A = 'admin@bini.test', B = 'other@bini.test';
  const PIN = '482913';
  let cookie, WEB = {}, HLP = {};

  /* ---------- access control ---------- */
  await test('app pages need sign-in', async function () {
    const r = await req('GET', '/'); eq(r.status, 302); eq(r.headers.get('location'), '/login.html');
    eq((await req('GET', '/index.html')).status, 302);
    eq((await req('GET', '/js/app.js')).status, 401);
    eq((await req('GET', '/js/api.js')).status, 401);
  });
  await test('only the sign-in page and its style are public', async function () {
    eq((await req('GET', '/login.html')).status, 200);
    eq((await req('GET', '/css/style.css')).status, 200);
    eq((await req('GET', '/js/login.js')).status, 200);
  });
  await test('data routes need sign-in', async function () {
    for (const p of ['/settings', '/systems', '/activity']) {
      const r = await req('GET', p); eq(r.status, 401, p); eq(r.json.code, 'NO_SESSION');
    }
    eq((await req('PUT', '/settings', { body: {} })).status, 401);
  });
  await test('conversion API needs a key', async function () {
    const r = await req('POST', '/v1/convert'); eq(r.status, 401); eq(r.json.system, 'WPC');
  });
  await test('security headers are set', async function () {
    const r = await req('GET', '/login.html');
    eq(r.headers.get('x-content-type-options'), 'nosniff'); eq(r.headers.get('x-frame-options'), 'DENY');
    ok(/default-src 'self'/.test(r.headers.get('content-security-policy')));
  });

  /* ---------- sign-in ---------- */
  await test('person not on the access list is refused', async function () {
    const r = await login(A); eq(r.status, 403); ok(!r.cookie);
  });
  await db.query("INSERT INTO allowed_users (public_id, email, name) VALUES ($1,$2,'Admin One'), ($3,$4,'Admin Two')", [crypto_.publicId(), A, crypto_.publicId(), B]);
  await test('person on the list signs in and sees the app', async function () {
    const r = await login(A); eq(r.status, 302); ok(r.cookie, 'no cookie');
    cookie = r.cookie;
    const s = await req('GET', '/session', { cookie }); eq(s.json.user.name, 'Admin One'); eq(s.json.user.role, 'Admin');
    eq((await req('GET', '/', { cookie })).status, 200);
    eq((await req('GET', '/js/app.js', { cookie })).status, 200);
  });
  await test('session cookie is HttpOnly and SameSite', async function () {
    const raw = (await req('GET', '/auth/dev-login?email=' + A)).headers.getSetCookie().join(';');
    ok(/HttpOnly/.test(raw) && /SameSite=Lax/.test(raw));
  });
  await test('writes from another origin are refused', async function () {
    const r = await req('PUT', '/settings', { cookie, headers: { Origin: 'http://evil.example' }, body: {}, origin: false });
    eq(r.status, 403); eq(r.json.code, 'BAD_ORIGIN');
  });

  /* ---------- PIN and key rotation ---------- */
  await test('PIN not set yet: protected actions are blocked', async function () {
    const r = await req('POST', '/systems/WEB/rotate', { cookie, body: { pin: PIN } }); eq(r.status, 503); eq(r.json.code, 'PIN_NOT_SET');
  });
  await db.tx(function (c) { return pin.store(c, PIN); });
  await test('PIN is stored as a slow salted hash', async function () {
    const h = (await db.query('SELECT pin_hash FROM admin_pin')).rows[0].pin_hash;
    ok(/^scrypt\$32768\$8\$1\$/.test(h) && h.indexOf(PIN) < 0);
  });
  await test('wrong PIN is refused and counts attempts', async function () {
    const r = await req('POST', '/systems/WEB/rotate', { cookie, body: { pin: '000000' } });
    eq(r.status, 403); eq(r.json.code, 'BAD_PIN'); eq(r.json.attemptsLeft, 2);
  });
  await test('right PIN rotates a key and shows it once', async function () {
    const r = await req('POST', '/systems/WEB/rotate', { cookie, body: { pin: PIN } });
    eq(r.status, 200);
    ok(/^[0-9a-f]{8}\.[0-9a-f]{64}$/.test(r.json.key), 'key format');
    ok(/^[0-9a-f]{64}$/.test(r.json.signingSecret), 'signing secret format');
    ok(/^WPC-KEY-\d{6}$/.test(r.json.id), 'key id');
    WEB = { key: r.json.key, secret: r.json.signingSecret, id: r.json.id };
    const r2 = await req('POST', '/systems/HLP/rotate', { cookie, body: { pin: PIN } });
    HLP = { key: r2.json.key, secret: r2.json.signingSecret };
  });
  await test('keys are stored hashed, never in clear', async function () {
    const rows = JSON.stringify((await db.query('SELECT * FROM api_keys')).rows);
    ok(rows.indexOf(WEB.key.split('.')[1]) < 0, 'key secret found in database');
    ok(rows.indexOf(WEB.secret) < 0, 'signing secret found in database');
  });
  await test('rotating again retires the old key at once', async function () {
    const old = WEB;
    const r = await req('POST', '/systems/WEB/rotate', { cookie, body: { pin: PIN } });
    WEB = { key: r.json.key, secret: r.json.signingSecret };
    const img = await sample(64, 64, 'png');
    eq((await client.convert(BASE, old.key, old.secret, img, 'a.png')).status, 401, 'old key still works');
    eq((await client.convert(BASE, WEB.key, WEB.secret, img, 'a.png')).status, 200, 'new key fails');
  });
  await test('keys expire after 90 days', async function () {
    const d = (await db.query("SELECT extract(day from (expires_at - created_at)) AS d FROM api_keys WHERE revoked_at IS NULL LIMIT 1")).rows[0].d;
    eq(Number(d), 90);
    await db.query("UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE key_id = $1", [HLP.key.split('.')[0]]);
    eq((await client.convert(BASE, HLP.key, HLP.secret, await sample(32, 32, 'png'), 'a.png')).status, 401, 'expired key accepted');
    await db.query("UPDATE api_keys SET expires_at = now() + interval '90 days' WHERE key_id = $1", [HLP.key.split('.')[0]]);
  });

  /* ---------- conversion API ---------- */
  let firstImgId;
  await test('API converts and answers with the documented fields', async function () {
    const img = await sample(200, 100, 'jpg', { IFD0: { Make: 'SecretCam', Software: 'Leaky 1.0' } }, 6);
    ok(img.indexOf('SecretCam') > -1, 'test image has no metadata');
    const r = await client.convert(BASE, WEB.key, WEB.secret, img, 'photo.jpg', { quality: 80 });
    eq(r.status, 200); const j = await r.json();
    eq(j.system, 'WPC'); eq(j.type, 'IMG'); ok(/^WPC-IMG-\d{6}$/.test(j.id), 'id ' + j.id);
    eq(j.requested_by, 'WEB'); eq(j.format, 'webp'); eq(j.bytes_in, img.length); ok(j.bytes_out > 0);
    ok(/^http/.test(j.url) && j.expires_at);
    firstImgId = j.id;
    const dl = await fetch(j.url); eq(dl.status, 200); eq(dl.headers.get('content-type'), 'image/webp');
    const out = Buffer.from(await dl.arrayBuffer());
    eq(out.length, j.bytes_out); eq(out.toString('ascii', 0, 4), 'RIFF'); eq(out.toString('ascii', 8, 12), 'WEBP');
    const meta = await sharp(out).metadata();
    eq(meta.width, 100, 'EXIF rotation should swap the sides'); eq(meta.height, 200);
  });
  await test('output carries no metadata (EXIF, location, device data)', async function () {
    const img = await sample(120, 80, 'jpg', { IFD0: { Make: 'SecretCam', Model: 'M1', Software: 'Leaky' } });
    const j = await (await client.convert(BASE, WEB.key, WEB.secret, img, 'p.jpg')).json();
    const out = Buffer.from(await (await fetch(j.url)).arrayBuffer());
    const names = chunks(out);
    ok(names.indexOf('EXIF') < 0 && names.indexOf('XMP ') < 0 && names.indexOf('ICCP') < 0, 'chunks: ' + names.join(','));
    ok(out.indexOf('SecretCam') < 0 && out.indexOf('Leaky') < 0, 'metadata text found in output');
  });
  await test('aspect ratios crop from the centre', async function () {
    const img = await sample(300, 200, 'png');
    for (const [a, w, h] of [['1:1', 200, 200], ['16:9', 300, 169], ['9:16', 113, 200], ['original', 300, 200]]) {
      const j = await (await client.convert(BASE, WEB.key, WEB.secret, img, 'a.png', { aspect: a })).json();
      const m = await sharp(Buffer.from(await (await fetch(j.url)).arrayBuffer())).metadata();
      ok(Math.abs(m.width - w) <= 1 && Math.abs(m.height - h) <= 1, a + ' gave ' + m.width + 'x' + m.height);
    }
  });
  await test('quality scale works, lossless mode works', async function () {
    const img = await sample(300, 300, 'png');
    const size = async function (f) { const j = await (await client.convert(BASE, WEB.key, WEB.secret, img, 'a.png', f)).json(); return j.bytes_out; };
    const lo = await size({ quality: 10 }), hi = await size({ quality: 95 }), ll = await size({ mode: 'lossless' });
    ok(lo < hi, 'quality 10 (' + lo + ') should be smaller than 95 (' + hi + ')');
    ok(ll > 0);
  });
  await test('all allowed types are accepted', async function () {
    const base = await sample(64, 64, 'png');
    const types = {
      png: base,
      jpg: await sharp(base).jpeg().toBuffer(),
      webp: await sharp(base).webp().toBuffer(),
      gif: await sharp(base).gif().toBuffer(),
      avif: await sharp(base).avif({ effort: 0 }).toBuffer(),
      bmp: Buffer.concat([Buffer.from('BM'), Buffer.alloc(0)]) // BMP is built below
    };
    // minimal 2x2 24-bit BMP
    const row = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0]); // 2 pixels (BGR) + 2 bytes padding
    const pix = Buffer.concat([row, row]);
    const hdr = Buffer.alloc(54); hdr.write('BM'); hdr.writeUInt32LE(54 + pix.length, 2); hdr.writeUInt32LE(54, 10);
    hdr.writeUInt32LE(40, 14); hdr.writeInt32LE(2, 18); hdr.writeInt32LE(2, 22); hdr.writeUInt16LE(1, 26); hdr.writeUInt16LE(24, 28); hdr.writeUInt32LE(pix.length, 34);
    types.bmp = Buffer.concat([hdr, pix]);
    for (const k of Object.keys(types)) {
      const r = await client.convert(BASE, WEB.key, WEB.secret, types[k], 'x.' + k);
      if (k === 'bmp' && r.status !== 200) { /* some libvips builds cannot read BMP: report, do not hide */ throw new Error('bmp not converted (status ' + r.status + ')'); }
      eq(r.status, 200, k);
    }
  });

  /* ---------- request security ---------- */
  await test('replayed request is rejected', async function () {
    const img = await sample(32, 32, 'png');
    const built = await client.build(WEB.key, WEB.secret, img, 'a.png');
    const send = function () { return fetch(BASE + '/v1/convert', { method: 'POST', headers: built.headers, body: built.body }); };
    eq((await send()).status, 200); eq((await send()).status, 401, 'replay accepted');
  });
  await test('bad signature, wrong secret, tampered body are rejected', async function () {
    const img = await sample(32, 32, 'png');
    eq((await client.convert(BASE, WEB.key, 'f'.repeat(64), img, 'a.png')).status, 401, 'wrong secret');
    const built = await client.build(WEB.key, WEB.secret, img, 'a.png');
    const tampered = Buffer.from(built.body); tampered[tampered.length - 20] ^= 1;
    eq((await fetch(BASE + '/v1/convert', { method: 'POST', headers: built.headers, body: tampered })).status, 401, 'tampered body');
    const h2 = Object.assign({}, built.headers, { 'X-Signature': 'zz' });
    eq((await fetch(BASE + '/v1/convert', { method: 'POST', headers: h2, body: built.body })).status, 401, 'bad format');
  });
  await test('old and future timestamps are rejected (5 minute window)', async function () {
    const img = await sample(32, 32, 'png'), now = Math.floor(Date.now() / 1000);
    for (const t of [now - 400, now + 400]) {
      const b = await client.build(WEB.key, WEB.secret, img, 'a.png', {}, t);
      eq((await fetch(BASE + '/v1/convert', { method: 'POST', headers: b.headers, body: b.body })).status, 401, 'ts ' + (t - now));
    }
    const ok1 = await client.build(WEB.key, WEB.secret, img, 'a.png', {}, now - 240);
    eq((await fetch(BASE + '/v1/convert', { method: 'POST', headers: ok1.headers, body: ok1.body })).status, 200, 'within window');
  });
  await test('bad key and missing headers are rejected', async function () {
    const img = await sample(32, 32, 'png');
    eq((await client.convert(BASE, '00000000.' + '0'.repeat(64), WEB.secret, img, 'a.png')).status, 401);
    const b = await client.build(WEB.key, WEB.secret, img, 'a.png');
    const h = Object.assign({}, b.headers); delete h['X-Timestamp'];
    eq((await fetch(BASE + '/v1/convert', { method: 'POST', headers: h, body: b.body })).status, 401);
  });
  await test('suspended system is refused', async function () {
    await db.query("UPDATE systems SET status='Suspended' WHERE code='WEB'");
    eq((await client.convert(BASE, WEB.key, WEB.secret, await sample(32, 32, 'png'), 'a.png')).status, 401);
    await db.query("UPDATE systems SET status='Active' WHERE code='WEB'");
  });

  /* ---------- file checks and limits ---------- */
  await test('file renamed to .png that is not an image is rejected (415)', async function () {
    const r = await client.convert(BASE, WEB.key, WEB.secret, Buffer.from('this is plain text, not an image'), 'fake.png');
    eq(r.status, 415); eq((await r.json()).system, 'WPC');
  });
  await test('allowed signature with damaged content is rejected (415)', async function () {
    const bad = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage garbage garbage')]);
    eq((await client.convert(BASE, WEB.key, WEB.secret, bad, 'a.png')).status, 415);
  });
  await test('invalid parameters are rejected (400)', async function () {
    const img = await sample(32, 32, 'png');
    for (const f of [{ quality: 5 }, { quality: 101 }, { quality: 'abc' }, { quality: 50.5 }, { mode: 'fast' }, { aspect: '4:3' }]) {
      eq((await client.convert(BASE, WEB.key, WEB.secret, img, 'a.png', f)).status, 400, JSON.stringify(f));
    }
  });
  await test('missing file, two files, wrong content type are rejected (400)', async function () {
    const mk = async function (formFn, ct) {
      const form = new FormData(); formFn(form);
      const packed = new Response(form); const body = Buffer.from(await packed.arrayBuffer());
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto_.hmac(WEB.secret, ts + '.', body);
      return fetch(BASE + '/v1/convert', { method: 'POST', body: body, headers: { Authorization: 'Bearer ' + WEB.key, 'X-Timestamp': ts, 'X-Signature': sig, 'Content-Type': ct || packed.headers.get('content-type') } });
    };
    const img = await sample(32, 32, 'png');
    eq((await mk(function (f) { f.append('quality', '70'); })).status, 400, 'no file');
    eq((await mk(function (f) { f.append('file', new Blob([img]), 'a.png'); f.append('file', new Blob([img]), 'b.png'); })).status, 400, 'two files');
    eq((await mk(function (f) { f.append('x', 'y'); }, 'application/json')).status, 400, 'not multipart');
  });
  await test('file over the size limit is rejected (413) and the limit is a setting', async function () {
    let r = await req('PUT', '/settings', { cookie, body: { values: { maxMb: 1, maxFiles: 50, defq: 75, retain: 30 }, pin: PIN } });
    eq(r.status, 200); eq(r.json.maxMb, 1);
    const bigish = Buffer.concat([await sample(10, 10, 'png'), Buffer.alloc(1.5 * 1048576)]); // valid PNG start, 1.5 MB
    eq((await client.convert(BASE, WEB.key, WEB.secret, bigish, 'big.png')).status, 413, '1.5 MB with 1 MB limit');
    const huge = Buffer.concat([await sample(10, 10, 'png'), Buffer.alloc(4 * 1048576)]);
    eq((await client.convert(BASE, WEB.key, WEB.secret, huge, 'huge.png')).status, 413, '4 MB with 1 MB limit');
    r = await req('PUT', '/settings', { cookie, body: { values: { maxMb: 50, maxFiles: 50, defq: 75, retain: 30 }, pin: PIN } });
    eq(r.status, 200);
  });
  await test('image with too many pixels is rejected', async function () {
    const png = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    ok(png.length < 50 * 1048576, 'test image too big: ' + png.length);
    const r = await client.convert(BASE, WEB.key, WEB.secret, png, 'big.png');
    eq(r.status, 413);
  });
  await test('rate limit per system key (429)', async function () {
    const img = await sample(24, 24, 'png'); const codes = [];
    cfg.apiRatePerMin = 8;
    for (let i = 0; i < 11; i++) codes.push((await client.convert(BASE, HLP.key, HLP.secret, img, 'a.png')).status);
    cfg.apiRatePerMin = 1000;
    ok(codes.indexOf(429) > -1, 'no 429 in ' + codes.join(','));
    ok(codes.slice(0, 5).every(function (c) { return c === 200; }), 'early calls should pass: ' + codes.join(','));
  });

  /* ---------- download links and file storage ---------- */
  await test('signed link: tampering, expiry and bad names are refused', async function () {
    const j = await (await client.convert(BASE, WEB.key, WEB.secret, await sample(32, 32, 'png'), 'a.png')).json();
    const u = new URL(j.url);
    const exp = Number(u.searchParams.get('exp')); ok(Math.abs(exp - (Date.now() / 1000 + 900)) < 10, 'link lifetime should be 15 minutes');
    const bad1 = new URL(u); bad1.searchParams.set('sig', '0'.repeat(64)); eq((await fetch(bad1)).status, 403);
    const bad2 = new URL(u); bad2.searchParams.set('exp', String(exp + 3600)); eq((await fetch(bad2)).status, 403, 'extended expiry');
    const pastExp = Math.floor(Date.now() / 1000) - 5, id = u.pathname.split('/').pop().replace('.webp', '');
    const bad3 = BASE + '/files/' + id + '.webp?exp=' + pastExp + '&sig=' + crypto_.linkSignature(id, pastExp); eq((await fetch(bad3)).status, 403, 'expired');
    eq((await fetch(BASE + '/files/..%2F..%2Fetc%2Fpasswd?exp=1&sig=x')).status, 403);
  });
  await test('only converted files are stored, and old ones are swept', async function () {
    const names = fs.readdirSync(process.env.STORAGE_DIR);
    ok(names.length > 0 && names.every(function (n) { return /^[A-Za-z0-9_-]{16}\.webp$/.test(n); }), 'unexpected files: ' + names.slice(0, 3));
    const old = path.join(process.env.STORAGE_DIR, names[0]);
    fs.utimesSync(old, new Date(Date.now() - 3600 * 1000), new Date(Date.now() - 3600 * 1000));
    await files.sweep();
    ok(!fs.existsSync(old), 'old file not removed');
  });

  /* ---------- settings, PIN, lock ---------- */
  await test('settings: bad values do not use a PIN attempt; good values save and are logged', async function () {
    let r = await req('PUT', '/settings', { cookie, body: { values: { maxMb: 500, maxFiles: 50, defq: 75, retain: 30 }, pin: 'wrong1' } });
    eq(r.status, 400); eq(r.json.code, 'BAD_VALUES');
    r = await req('PUT', '/settings', { cookie, body: { values: { maxMb: 50, maxFiles: 20, defq: 80, retain: 45 }, pin: PIN } });
    eq(r.status, 200); eq(r.json.maxFiles, 20); eq(r.json.defq, 80);
    eq((await req('GET', '/settings', { cookie })).json.retain, 45);
    const log = (await req('GET', '/activity', { cookie })).json.entries;
    ok(log.some(function (e) { return /Settings changed: maxFiles 50 to 20/.test(e.detail); }), 'settings change not logged');
    await req('PUT', '/settings', { cookie, body: { values: { maxMb: 50, maxFiles: 50, defq: 75, retain: 30 }, pin: PIN } });
  });
  await test('3 wrong PINs lock the action for 15 minutes and alert the core admin', async function () {
    const body = function (p) { return { values: { maxMb: 50, maxFiles: 50, defq: 75, retain: 30 }, pin: p }; };
    eq((await req('PUT', '/settings', { cookie, body: body('111111') })).status, 403);
    eq((await req('PUT', '/settings', { cookie, body: body('222222') })).status, 403);
    const third = await req('PUT', '/settings', { cookie, body: body('333333') }); eq(third.status, 423); eq(third.json.code, 'LOCKED');
    eq((await req('PUT', '/settings', { cookie, body: body(PIN) })).status, 423, 'right PIN accepted while locked');
    eq((await req('POST', '/systems/WEB/rotate', { cookie, body: { pin: PIN } })).status, 423, 'lock covers key rotation too');
    const log = (await req('GET', '/activity', { cookie })).json.entries;
    ok(log.some(function (e) { return e.result === 'Alert for core admin'; }), 'no alert entry');
    const until = (await db.query('SELECT locked_until FROM admin_pin')).rows[0].locked_until;
    const mins = (new Date(until) - Date.now()) / 60000; ok(mins > 14 && mins <= 15, 'lock length ' + mins);
    await db.query('UPDATE admin_pin SET locked_until = now() - interval \'1 second\'');
    eq((await req('PUT', '/settings', { cookie, body: body(PIN) })).status, 200, 'unlock after 15 minutes');
  });
  await test('Change PIN: needs current PIN, 6 digits, different; old PIN stops working', async function () {
    eq((await req('POST', '/pin/change', { cookie, body: { current: 'nope00', next: '135790' } })).status, 403);
    eq((await req('POST', '/pin/change', { cookie, body: { current: PIN, next: '12345' } })).status, 400);
    eq((await req('POST', '/pin/change', { cookie, body: { current: PIN, next: PIN } })).status, 400);
    eq((await req('POST', '/pin/change', { cookie, body: { current: PIN, next: '135790' } })).status, 200);
    eq((await req('POST', '/systems/WEB/rotate', { cookie, body: { pin: PIN } })).status, 403, 'old PIN works');
    eq((await req('POST', '/systems/WEB/rotate', { cookie, body: { pin: '135790' } })).status, 200, 'new PIN fails');
  });

  /* ---------- API Integrations and Activity Log ---------- */
  await test('systems list: six systems, usage, key status, no internal ids', async function () {
    const r = await req('GET', '/systems', { cookie }); eq(r.status, 200);
    const s = r.json.systems; eq(s.length, 6);
    eq(s.map(function (x) { return x.code; }).sort().join(','), 'BLG,CMP,FDK,HLP,W2F,WEB');
    const web = s.find(function (x) { return x.code === 'WEB'; });
    ok(web.requests > 5 && web.success > 0 && web.status === 'Active' && /\.••••/.test(web.keyHint), JSON.stringify(web));
    eq(s.find(function (x) { return x.code === 'BLG'; }).status, 'No key');
    ok(!/"id"|public_id|system_id|key_hash/.test(r.text), 'internal fields leaked');
  });
  await test('activity log: who, what, size, result; IDs follow SYSTEM-TYPE-NUMBER', async function () {
    const r = await req('GET', '/activity', { cookie }); eq(r.status, 200);
    const e = r.json.entries;
    ok(e.every(function (x) { return /^WPC-ACT-\d{6}$/.test(x.id); }), 'activity ids');
    ok(e.some(function (x) { return x.who === 'WEB' && x.kind === 'System' && x.result === 'Success' && / to /.test(x.size); }), 'system conversion row');
    ok(e.some(function (x) { return x.result === 'Rejected: file type'; }), 'file type rejection row');
    ok(e.some(function (x) { return /Key rotated: WEB/.test(x.detail) && x.kind === 'Admin'; }), 'key rotation row');
    const ids = e.map(function (x) { return x.id; }); eq(new Set(ids).size, ids.length, 'duplicate ids');
  });
  await test('IDs: sequential, never reused, composite format everywhere', async function () {
    const r = await db.query('SELECT composite_id FROM conversions ORDER BY id');
    ok(r.rows.length > 5 && r.rows.every(function (x) { return /^WPC-IMG-\d{6}$/.test(x.composite_id); }));
    ok(r.rows.some(function (x) { return x.composite_id === firstImgId; }), 'first id missing');
    const nums = r.rows.map(function (x) { return Number(x.composite_id.slice(8)); });
    ok(nums.every(function (n, i) { return i === 0 || n > nums[i - 1]; }), 'ids not increasing');
    const pub = (await db.query('SELECT public_id FROM conversions LIMIT 1')).rows[0].public_id; eq(pub.length, 16);
    const used = (await db.query('SELECT last_value FROM wpc_img_seq')).rows[0].last_value;
    ok(Number(used) >= r.rows.length, 'sequence behind records');
  });
  await test('browser tool reports counts and sizes only', async function () {
    let r = await req('POST', '/activity/conversion', { cookie, body: { count: 3, failed: 1, bytesIn: 3000000, bytesOut: 900000 } }); eq(r.status, 200);
    const e = (await req('GET', '/activity', { cookie })).json.entries[0];
    eq(e.kind, 'Staff'); eq(e.who, 'Admin One'); ok(/3 images \(browser\)/.test(e.detail)); ok(/Partly done/.test(e.result));
    eq((await req('POST', '/activity/conversion', { cookie, body: { count: -1, failed: 0, bytesIn: 1, bytesOut: 1 } })).status, 400);
    eq((await req('POST', '/activity/conversion', { cookie, body: { count: 999, failed: 0, bytesIn: 1, bytesOut: 1 } })).status, 400);
  });
  await test('activity older than the retention setting is deleted', async function () {
    await db.query("INSERT INTO activity (public_id, composite_id, occurred_at, actor, kind, detail, result) VALUES ('oldoldoldoldold1','WPC-ACT-900001', now() - interval '40 days', 'X','System','old','Success')");
    await jobs.applyRetention();
    eq((await db.query("SELECT count(*) AS n FROM activity WHERE composite_id = 'WPC-ACT-900001'")).rows[0].n, '0');
  });

  /* ---------- access list, suspension, break-glass, sign-out ---------- */
  await test('suspending a person blocks them on the very next request', async function () {
    const b = await login(B); ok(b.cookie);
    eq((await req('GET', '/settings', { cookie: b.cookie })).status, 200);
    await db.query("UPDATE allowed_users SET status='suspended' WHERE email=$1", [B]);
    eq((await req('GET', '/settings', { cookie: b.cookie })).status, 401, 'suspended user still in');
    eq((await login(B)).status, 403, 'suspended user can sign in again');
    await db.query("UPDATE allowed_users SET status='active' WHERE email=$1", [B]);
  });
  await test('break-glass: password and authenticator code, logged, no SSO needed', async function () {
    const secret = crypto_.newTotpSecret();
    await db.query('INSERT INTO break_glass (id, username, password_hash, totp_secret_enc) VALUES (1,$1,$2,$3)',
      ['glass', await crypto_.hashSecret('a-long-break-glass-password'), crypto_.encrypt(secret)]);
    const attempt = function (b) { return req('POST', '/auth/break-glass', { body: b }); };
    const code = crypto_.totpAt(secret, Math.floor(Date.now() / 30000));
    eq((await attempt({ username: 'glass', password: 'wrong-wrong-wrong-pw', code: code })).status, 401, 'wrong password');
    eq((await attempt({ username: 'glass', password: 'a-long-break-glass-password', code: code === '000000' ? '111111' : '000000' })).status, 401, 'wrong code');
    const good = await attempt({ username: 'glass', password: 'a-long-break-glass-password', code: code });
    eq(good.status, 200); const c = cookieOf(good); ok(c);
    eq((await req('GET', '/session', { cookie: c })).json.user.name, 'Break-glass admin');
    ok(/TOTP|secret/i.test(JSON.stringify((await db.query('SELECT username, password_hash FROM break_glass')).rows)) === false);
    const stored = (await db.query('SELECT totp_secret_enc FROM break_glass')).rows[0].totp_secret_enc;
    ok(stored.indexOf(secret) < 0, '2FA secret stored in clear');
    const log = (await req('GET', '/activity', { cookie: c })).json.entries;
    ok(log.some(function (e) { return e.detail === 'Break-glass sign-in' && e.result === 'Success'; }), 'sign-in not logged');
  });
  await test('sign out ends the session', async function () {
    const c = (await login(A)).cookie;
    eq((await req('POST', '/auth/logout', { cookie: c })).status, 200);
    eq((await req('GET', '/settings', { cookie: c })).status, 401);
  });
  await test('rate limit per signed-in user', async function () {
    const c = (await login(B)).cookie; const codes = [];
    for (let i = 0; i < 125; i++) codes.push((await req('GET', '/settings', { cookie: c })).status);
    ok(codes.indexOf(429) > -1, 'no 429 after 125 calls');
  });
  await test('server errors never leak details', async function () {
    const r = await req('GET', '/nope'); eq(r.status, 401); // not signed in: even unknown paths reveal nothing
    const r2 = await req('GET', '/nope', { cookie: (await login(A)).cookie }); eq(r2.status, 404); eq(r2.json.system, 'WPC');
    ok(!/at .*\.js|node_modules/.test(r2.text));
  });

  server.close();
  await db.end();
  fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed' + (failures.length ? ': ' + failures.join('; ') : ''));
  process.exit(failures.length ? 1 : 0);
}

main().catch(function (e) { console.error('Test run crashed:', e); process.exit(2); });
