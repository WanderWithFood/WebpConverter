const crypto = require('crypto');
const util = require('util');
const cfg = require('./config');

const scrypt = util.promisify(crypto.scrypt);

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function hmac(secret, ...parts) {
  const h = crypto.createHmac('sha256', secret);
  parts.forEach(function (p) { h.update(p); });
  return h.digest('hex');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function randomHex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }
function randomToken(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
// 16-character random public id
function publicId() { return crypto.randomBytes(12).toString('base64url'); }

/* ----- slow salted hash (PIN, break-glass password) ----- */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };
async function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifySecret(plain, stored) {
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
  const N = +parts[1], r = +parts[2], p = +parts[3];
  const salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  const got = await scrypt(String(plain), salt, want.length, { N: N, r: r, p: p, maxmem: 128 * 1024 * 1024 });
  return crypto.timingSafeEqual(got, want);
}

/* ----- values derived from MASTER_SECRET ----- */
// The signing secret that goes with an API key. Derived, not stored, so keys can be stored hashed only.
function signingSecretFor(keyId) {
  cfg.requireMaster();
  return hmac(cfg.masterSecret, 'sign:' + keyId);
}
function linkSignature(id, exp) {
  cfg.requireMaster();
  return hmac(cfg.masterSecret, 'link:' + id + '.' + exp);
}
function cookieSignature(value) {
  cfg.requireMaster();
  return hmac(cfg.masterSecret, 'cookie:' + value);
}

/* ----- AES-256-GCM for the break-glass 2FA secret ----- */
function aesKey() { cfg.requireMaster(); return crypto.createHash('sha256').update('aes:' + cfg.masterSecret).digest(); }
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
function decrypt(blob) {
  const p = String(blob).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(p[0], 'base64'));
  d.setAuthTag(Buffer.from(p[1], 'base64'));
  return Buffer.concat([d.update(Buffer.from(p[2], 'base64')), d.final()]).toString('utf8');
}

/* ----- TOTP (RFC 6238, 6 digits, 30 s) for the break-glass account ----- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = '', out = '';
  buf.forEach(function (b) { bits += b.toString(2).padStart(8, '0'); });
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function base32Decode(str) {
  let bits = '';
  str.replace(/=+$/, '').toUpperCase().split('').forEach(function (c) { bits += B32.indexOf(c).toString(2).padStart(5, '0'); });
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1000000).padStart(6, '0');
}
function totpVerify(secretB32, code) {
  if (!/^\d{6}$/.test(String(code))) return false;
  const c = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some(function (d) { return safeEqual(totpAt(secretB32, c + d), code); });
}
function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

module.exports = {
  sha256, hmac, safeEqual, randomHex, randomToken, publicId,
  hashSecret, verifySecret,
  signingSecretFor, linkSignature, cookieSignature,
  encrypt, decrypt,
  totpAt, totpVerify, newTotpSecret
};
