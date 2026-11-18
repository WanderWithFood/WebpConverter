const express = require('express');
const db = require('./db');
const cfg = require('./config');
const { HttpError } = require('./errors');
const { verifySecret, decrypt, totpVerify } = require('./crypto');
const { consume } = require('./ratelimit');
const sessions = require('./session');
const sso = require('./sso');
const activity = require('./activity');

const router = express.Router();

function refused(res, status, text) {
  res.status(status).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link rel="stylesheet" href="/css/style.css"><div class="login"><div class="card lc"><div class="logo logo-lg">B</div><h1>BINI Image Converter</h1>' +
    '<p>' + text + '</p><a class="btn" style="display:block;text-align:center;text-decoration:none" href="/login.html">Back to sign in</a></div></div>');
}

async function findAllowed(email) {
  const r = await db.query('SELECT id, name, status FROM allowed_users WHERE lower(email) = lower($1)', [email]);
  return r.rows[0];
}

async function enter(req, res, person) {
  const u = await findAllowed(person.email);
  if (!u || u.status !== 'active') {
    await activity.log(db, { actor: person.email, kind: 'Staff', detail: 'Sign-in refused: no access', result: 'Rejected: access' });
    return refused(res, 403, 'Your account does not have access to this portal. Ask the core admin to grant access.');
  }
  await sessions.create(res, 'sso', u.id, u.name);
  res.redirect('/');
}

// Sign in through Founders Desk.
router.get('/auth/login', function (req, res, next) {
  try { sso.start(req, res); } catch (e) {
    if (e instanceof HttpError) return refused(res, e.status, e.message);
    next(e);
  }
});
router.get('/auth/callback', async function (req, res, next) {
  try {
    const person = await sso.finish(req);
    sso.clearState(res);
    await enter(req, res, person);
  } catch (e) {
    if (e instanceof HttpError) return refused(res, e.status, e.message);
    next(e);
  }
});

// Local testing only. Never available in production.
if (cfg.devLogin) {
  router.get('/auth/dev-login', async function (req, res, next) {
    try { await enter(req, res, { email: String(req.query.email || '') }); } catch (e) { next(e); }
  });
}

// Break-glass Admin. Outside single sign-on. Password plus authenticator code. Logged.
router.post('/auth/break-glass', sessions.sameSite, express.json({ limit: '2kb' }), async function (req, res, next) {
  try {
    if (!consume('bg:' + req.ip, 10, 15 * 60000)) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const b = req.body || {};
    const r = await db.query('SELECT * FROM break_glass WHERE id = 1');
    const row = r.rows[0];
    if (row && row.locked_until && new Date(row.locked_until) > new Date()) {
      throw new HttpError(423, 'LOCKED', 'Locked for 15 minutes after repeated wrong attempts.');
    }
    const ok = !!row && typeof b.username === 'string' && b.username === row.username &&
      typeof b.password === 'string' && await verifySecret(b.password, row.password_hash) &&
      totpVerify(decrypt(row.totp_secret_enc), b.code);
    if (!ok) {
      if (row) {
        const failed = row.failed_attempts + 1;
        if (failed >= 5) {
          await db.query("UPDATE break_glass SET failed_attempts = 0, locked_until = now() + interval '15 minutes' WHERE id = 1");
          await activity.log(db, { actor: 'Break-glass', kind: 'Admin', detail: 'Break-glass sign-in locked for 15 minutes', result: 'Alert for core admin' });
        } else {
          await db.query('UPDATE break_glass SET failed_attempts = $1 WHERE id = 1', [failed]);
          await activity.log(db, { actor: 'Break-glass', kind: 'Admin', detail: 'Break-glass sign-in failed', result: 'Rejected: credentials' });
        }
      }
      throw new HttpError(401, 'BAD_CREDENTIALS', 'Sign-in details are not correct.');
    }
    await db.query('UPDATE break_glass SET failed_attempts = 0, locked_until = NULL WHERE id = 1');
    await sessions.create(res, 'break_glass', null, 'Break-glass admin');
    await activity.log(db, { actor: 'Break-glass', kind: 'Admin', detail: 'Break-glass sign-in', result: 'Success' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/auth/logout', sessions.sameSite, async function (req, res, next) {
  try { await sessions.destroy(req, res); res.json({ ok: true }); } catch (e) { next(e); }
});

// Who am I. Public: answers { user: null } when not signed in.
router.get('/session', function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user ? { name: req.user.name, role: req.user.role } : null });
});

module.exports = router;
