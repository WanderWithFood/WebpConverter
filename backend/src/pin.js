/* The Image Converter's own PIN. Held by the core admin, never shared.
   Three wrong attempts lock the action for 15 minutes and alert the core admin.
   Every PIN use is logged. Until Amazon SES is added, the alert is an entry in the Activity Log. */
const db = require('./db');
const cfg = require('./config');
const { HttpError } = require('./errors');
const { hashSecret, verifySecret } = require('./crypto');
const activity = require('./activity');

// Verifies the PIN for an action. Throws 423 LOCKED, 403 BAD_PIN or 503 PIN_NOT_SET.
async function check(pin, actor, action) {
  // The decision is made inside the transaction and committed first, then thrown outside it,
  // so the failed-attempt counter is saved even though the request fails.
  const outcome = await db.tx(async function (c) {
    const r = await c.query('SELECT * FROM admin_pin WHERE id = 1 FOR UPDATE');
    const row = r.rows[0];
    if (!row) return { type: 'NOT_SET' };
    if (row.locked_until && new Date(row.locked_until) > new Date()) return { type: 'LOCKED' };

    const ok = typeof pin === 'string' && /^\d{6}$/.test(pin) && await verifySecret(pin, row.pin_hash);
    if (ok) {
      if (row.failed_attempts) await c.query('UPDATE admin_pin SET failed_attempts = 0 WHERE id = 1');
      await activity.log(c, { actor: actor, kind: 'Admin', detail: 'PIN used: ' + action, result: 'Success' });
      return { type: 'OK' };
    }

    const failed = row.failed_attempts + 1;
    if (failed >= cfg.pinMaxAttempts) {
      await c.query("UPDATE admin_pin SET failed_attempts = 0, locked_until = now() + ($1 || ' minutes')::interval WHERE id = 1", [String(cfg.pinLockMinutes)]);
      await activity.log(c, { actor: actor, kind: 'Admin', detail: 'PIN wrong ' + cfg.pinMaxAttempts + ' times, locked for ' + cfg.pinLockMinutes + ' minutes (' + action + ')', result: 'Alert for core admin' });
      return { type: 'LOCKED' };
    }
    await c.query('UPDATE admin_pin SET failed_attempts = $1 WHERE id = 1', [failed]);
    await activity.log(c, { actor: actor, kind: 'Admin', detail: 'Wrong PIN (' + action + ')', result: 'Rejected: PIN' });
    return { type: 'BAD', left: cfg.pinMaxAttempts - failed };
  });

  if (outcome.type === 'OK') return;
  if (outcome.type === 'NOT_SET') throw new HttpError(503, 'PIN_NOT_SET', 'The system PIN has not been set yet. The core admin must set it first.');
  if (outcome.type === 'LOCKED') throw new HttpError(423, 'LOCKED', 'Locked for ' + cfg.pinLockMinutes + ' minutes. The core admin has been alerted.');
  throw new HttpError(403, 'BAD_PIN', 'Incorrect PIN.', { attemptsLeft: outcome.left });
}

// Sets or replaces the stored PIN hash. Callers check the old PIN first (Change PIN) or are the setup script.
async function store(client, newPin) {
  const hash = await hashSecret(newPin);
  await client.query(
    'INSERT INTO admin_pin (id, pin_hash) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET pin_hash = $1, failed_attempts = 0, locked_until = NULL, updated_at = now()',
    [hash]
  );
}

module.exports = { check, store };
