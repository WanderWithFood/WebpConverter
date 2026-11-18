/* Run by the core admin. Sets the Image Converter's own PIN (6 digits).
   The PIN is typed here, hashed, and stored as a slow salted hash. It is never shown or kept anywhere else.
   Later changes are made in the portal under Settings > Security > Change PIN. */
const db = require('../src/db');
const pin = require('../src/pin');
const activity = require('../src/activity');
const ask = require('./prompt');

async function main() {
  const existing = await db.query('SELECT 1 FROM admin_pin WHERE id = 1');
  if (existing.rowCount && process.argv[2] !== '--force') {
    console.error('A PIN is already set. Change it in the portal (Settings > Security > Change PIN).\nIf it is lost, run this again with --force.');
    process.exit(1);
  }
  const a = await ask('New 6-digit PIN: ');
  const b = await ask('Repeat the PIN: ');
  if (!/^\d{6}$/.test(a)) { console.error('The PIN must be exactly 6 digits.'); process.exit(1); }
  if (a !== b) { console.error('The two PINs do not match.'); process.exit(1); }
  await db.tx(async function (c) {
    await pin.store(c, a);
    await activity.log(c, { actor: 'Core admin (setup)', kind: 'Admin', detail: existing.rowCount ? 'System PIN reset from the server' : 'System PIN set', result: 'Success' });
  });
  console.log('PIN saved.');
  await db.end();
}
main().catch(function (e) { console.error('Failed:', e.message); process.exit(1); });
