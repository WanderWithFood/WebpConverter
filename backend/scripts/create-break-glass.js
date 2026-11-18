/* Creates (or replaces) the single break-glass Admin account that stays outside single sign-on.
   Sign-in needs the username, the password and a 6-digit authenticator code.
   This prints the authenticator secret ONCE. Add it to an authenticator app and store the password safely.
     node scripts/create-break-glass.js <username> */
const db = require('../src/db');
const cfg = require('../src/config');
const { hashSecret, encrypt, newTotpSecret } = require('../src/crypto');
const activity = require('../src/activity');
const ask = require('./prompt');

async function main() {
  cfg.requireMaster();
  const username = process.argv[2];
  if (!username) { console.error('Usage: node scripts/create-break-glass.js <username>'); process.exit(1); }
  const pw = await ask('Password (at least 14 characters): ');
  if (pw.length < 14) { console.error('The password must be at least 14 characters.'); process.exit(1); }
  const secret = newTotpSecret();
  await db.tx(async function (c) {
    await c.query(
      `INSERT INTO break_glass (id, username, password_hash, totp_secret_enc) VALUES (1,$1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET username=$1, password_hash=$2, totp_secret_enc=$3, failed_attempts=0, locked_until=NULL`,
      [username, await hashSecret(pw), encrypt(secret)]);
    await activity.log(c, { actor: 'Core admin (setup)', kind: 'Admin', detail: 'Break-glass account created or replaced', result: 'Success' });
  });
  console.log('\nBreak-glass account saved.');
  console.log('Authenticator secret (shown once): ' + secret);
  console.log('Or open this in an authenticator app: otpauth://totp/BINI%20Image%20Converter:' + encodeURIComponent(username) + '?secret=' + secret + '&issuer=BINI%20Image%20Converter');
  await db.end();
}
main().catch(function (e) { console.error('Failed:', e.message); process.exit(1); });
