/* Pages' data: Settings, Change PIN, API Integrations (systems and keys), Activity Log, and staff conversion records.
   One panel for everyone with access. Rotating a key and saving settings need the system PIN. */
const express = require('express');
const db = require('./db');
const cfg = require('./config');
const { HttpError } = require('./errors');
const { verifySecret } = require('./crypto');
const settings = require('./settings');
const activity = require('./activity');
const pin = require('./pin');
const keys = require('./keys');
const sessions = require('./session');

const router = express.Router();
// Only these paths belong to this router, so the guards below never touch other routes or the static files.
const PATHS = ['/settings', '/pin', '/systems', '/activity'];
router.use(PATHS, sessions.require, sessions.sameSite, sessions.userLimit, express.json({ limit: '8kb' }));
router.use(PATHS, function (req, res, next) { res.set('Cache-Control', 'no-store'); next(); });

const wrap = function (fn) { return function (req, res, next) { Promise.resolve(fn(req, res)).catch(next); }; };

/* ----- Settings ----- */
router.get('/settings', wrap(async function (req, res) {
  res.json(await settings.get());
}));

router.put('/settings', wrap(async function (req, res) {
  const values = settings.validate(req.body && req.body.values); // wrong values do not use up a PIN attempt
  const before = await settings.get();
  await pin.check(req.body.pin, req.user.name, 'settings');
  const changed = settings.RULES.filter(function (r) { return before[r[0]] !== values[r[0]]; })
    .map(function (r) { return r[0] + ' ' + before[r[0]] + ' to ' + values[r[0]]; });
  await db.tx(async function (c) {
    await settings.save(c, values);
    await activity.log(c, { actor: req.user.name, kind: 'Admin', detail: 'Settings changed' + (changed.length ? ': ' + changed.join(', ') : ' (no differences)'), result: 'Success' });
  });
  res.json(await settings.get());
}));

/* ----- Change PIN ----- */
router.post('/pin/change', wrap(async function (req, res) {
  const b = req.body || {};
  if (typeof b.next !== 'string' || !/^\d{6}$/.test(b.next)) throw new HttpError(400, 'BAD_VALUES', 'New PIN must be 6 digits.');
  if (b.next === b.current) throw new HttpError(400, 'BAD_VALUES', 'Choose a PIN different from the current one.');
  await pin.check(b.current, req.user.name, 'change PIN');
  await db.tx(async function (c) {
    await pin.store(c, b.next);
    await activity.log(c, { actor: req.user.name, kind: 'Admin', detail: 'System PIN changed', result: 'Success' });
  });
  res.json({ ok: true });
}));

/* ----- API Integrations ----- */
function keyStatus(r) {
  if (r.status === 'Suspended') return 'Suspended';
  if (!r.key_id) return 'No key';
  const left = new Date(r.expires_at) - new Date();
  if (left <= 0) return 'Expired';
  if (left < 14 * 86400000) return 'Expires soon';
  return 'Active';
}

router.get('/systems', wrap(async function (req, res) {
  const r = await db.query(
    `SELECT s.name, s.code, s.status, k.key_id, k.hint, k.expires_at,
            (SELECT max(occurred_at) FROM activity a WHERE a.kind = 'System' AND a.actor = s.code) AS last_used,
            (SELECT count(*) FROM activity a WHERE a.kind = 'System' AND a.actor = s.code AND a.occurred_at > now() - interval '30 days') AS reqs,
            (SELECT count(*) FROM activity a WHERE a.kind = 'System' AND a.actor = s.code AND a.occurred_at > now() - interval '30 days' AND a.result = 'Success') AS oks
       FROM systems s LEFT JOIN api_keys k ON k.system_id = s.id AND k.revoked_at IS NULL
      ORDER BY s.name`);
  res.json({
    systems: r.rows.map(function (x) {
      const reqs = Number(x.reqs), oks = Number(x.oks);
      return {
        name: x.name, code: x.code,
        keyHint: x.key_id ? x.key_id + '.••••' + x.hint : 'No key yet',
        keyExpires: x.expires_at, lastUsed: x.last_used,
        requests: reqs, success: reqs ? Math.round(oks / reqs * 1000) / 10 : null,
        status: keyStatus(x)
      };
    })
  });
}));

router.post('/systems/:code/rotate', wrap(async function (req, res) {
  const code = String(req.params.code).toUpperCase();
  const sys = (await db.query('SELECT id, name FROM systems WHERE code = $1', [code])).rows[0];
  if (!sys) throw new HttpError(404, 'NOT_FOUND', 'Unknown system.');
  await pin.check(req.body && req.body.pin, req.user.name, 'rotate key ' + code);
  const out = await db.tx(async function (c) {
    const k = await keys.rotate(c, sys.id);
    await activity.log(c, { actor: req.user.name, kind: 'Admin', detail: 'Key rotated: ' + code, result: 'Success', ref: k.id });
    return k;
  });
  // The key and signing secret are returned this once. They are not stored and cannot be shown again.
  res.json({ id: out.id, key: out.key, signingSecret: out.signingSecret });
}));

/* ----- Activity Log ----- */
router.get('/activity', wrap(async function (req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  const r = await db.query(
    'SELECT composite_id, occurred_at, actor, kind, detail, size_change, result FROM activity ORDER BY occurred_at DESC, id DESC LIMIT $1', [limit]);
  res.json({
    entries: r.rows.map(function (x) {
      return { id: x.composite_id, time: x.occurred_at, who: x.actor, kind: x.kind, detail: x.detail, size: x.size_change, result: x.result };
    })
  });
}));

// The browser tool converts on the staff member's computer. It reports only counts and sizes here, never files.
router.post('/activity/conversion', wrap(async function (req, res) {
  const b = req.body || {};
  const s = await settings.get();
  const int = function (v, max) { return Number.isInteger(v) && v >= 0 && v <= max; };
  if (!int(b.count, s.maxFiles) || !int(b.failed, s.maxFiles) || !int(b.bytesIn, s.maxFiles * s.maxMb * 1048576) || !int(b.bytesOut, s.maxFiles * s.maxMb * 1048576) || b.count < 1) {
    throw new HttpError(400, 'BAD_VALUES', 'Invalid conversion summary.');
  }
  const ok = b.count - b.failed;
  await activity.log(db, {
    actor: req.user.name, kind: 'Staff',
    detail: b.count + ' image' + (b.count === 1 ? '' : 's') + ' (browser)',
    size: activity.mb(b.bytesIn) + ' to ' + activity.mb(b.bytesOut),
    result: b.failed ? (ok ? 'Partly done: ' + b.failed + ' failed' : 'Failed') : 'Success'
  });
  res.json({ ok: true });
}));

module.exports = router;
