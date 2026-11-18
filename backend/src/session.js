const db = require('./db');
const cfg = require('./config');
const { HttpError } = require('./errors');
const { sha256, randomToken } = require('./crypto');
const { consume } = require('./ratelimit');

const COOKIE = 'bini_sid';

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(function (p) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function cookieString(name, value, maxAgeSeconds) {
  return name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSeconds + (cfg.production || cfg.publicUrl.startsWith('https://') ? '; Secure' : '');
}

async function create(res, kind, userId, name) {
  const sid = randomToken(32);
  await db.query(
    "INSERT INTO sessions (sid_hash, user_kind, user_id, name, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)",
    [sha256(sid), kind, userId, name, String(cfg.sessionHours)]
  );
  res.append('Set-Cookie', cookieString(COOKIE, sid, cfg.sessionHours * 3600));
}

async function destroy(req, res) {
  const sid = parseCookies(req)[COOKIE];
  if (sid) await db.query('DELETE FROM sessions WHERE sid_hash = $1', [sha256(sid)]);
  res.append('Set-Cookie', cookieString(COOKIE, '', 0));
}

/* Loads req.user when the cookie holds a valid session.
   A person removed or suspended in the access list loses access on their very next request. */
async function load(req, res, next) {
  try {
    const sid = parseCookies(req)[COOKIE];
    if (sid) {
      const r = await db.query(
        `SELECT s.user_kind, s.user_id, s.name, u.status
           FROM sessions s LEFT JOIN allowed_users u ON u.id = s.user_id
          WHERE s.sid_hash = $1 AND s.expires_at > now()`, [sha256(sid)]);
      const row = r.rows[0];
      if (row && (row.user_kind === 'break_glass' || row.status === 'active')) {
        req.user = { kind: row.user_kind, id: row.user_id, name: row.name, role: 'Admin' };
      }
    }
    next();
  } catch (e) { next(e); }
}

function require_(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'NO_SESSION', 'Sign in required.'));
  next();
}

// Rejects cookie-authenticated writes that did not come from this site.
function sameSite(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].indexOf(req.method) > -1) return next();
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  const ok = origin ? origin === new URL(cfg.publicUrl).origin : fetchSite ? fetchSite === 'same-origin' : false;
  if (!ok) return next(new HttpError(403, 'BAD_ORIGIN', 'Request not allowed from this origin.'));
  next();
}

// Rate limit per signed-in user.
function userLimit(req, res, next) {
  const key = 'user:' + (req.user ? req.user.kind + ':' + (req.user.id || 'bg') : req.ip);
  if (!consume(key, cfg.userRatePerMin, 60000)) return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.'));
  next();
}

module.exports = { parseCookies, cookieString, create, destroy, load, require: require_, sameSite, userLimit };
