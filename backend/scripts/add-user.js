/* TEMPORARY access list, used until MCP is built and grants access instead.
     node scripts/add-user.js add you@bini.example "Full Name"
     node scripts/add-user.js suspend you@bini.example     (blocks sign-in at once)
     node scripts/add-user.js activate you@bini.example
     node scripts/add-user.js list
   A person listed here still has to sign in through Founders Desk. This portal creates no passwords. */
const db = require('../src/db');
const { publicId } = require('../src/crypto');
const activity = require('../src/activity');

async function main() {
  const [cmd, email, name] = process.argv.slice(2);
  if (cmd === 'list') {
    const r = await db.query('SELECT email, name, status FROM allowed_users ORDER BY name');
    r.rows.forEach(function (u) { console.log(u.status.padEnd(10), u.email.padEnd(36), u.name); });
    if (!r.rowCount) console.log('No users yet.');
  } else if (cmd === 'add' && email && name) {
    await db.query('INSERT INTO allowed_users (public_id, email, name) VALUES ($1,$2,$3) ON CONFLICT (lower(email)) DO UPDATE SET name = $3, status = $4', [publicId(), email, name, 'active']);
    await activity.log(db, { actor: 'Core admin (setup)', kind: 'Admin', detail: 'Access granted: ' + email, result: 'Success' });
    console.log('Access granted to ' + email);
  } else if ((cmd === 'suspend' || cmd === 'activate') && email) {
    const r = await db.query('UPDATE allowed_users SET status = $2 WHERE lower(email) = lower($1)', [email, cmd === 'suspend' ? 'suspended' : 'active']);
    if (!r.rowCount) { console.error('No such user.'); process.exit(1); }
    await activity.log(db, { actor: 'Core admin (setup)', kind: 'Admin', detail: (cmd === 'suspend' ? 'Access suspended: ' : 'Access restored: ') + email, result: 'Success' });
    console.log('Done.');
  } else {
    console.error('Usage: add <email> "<name>" | suspend <email> | activate <email> | list');
    process.exit(1);
  }
  await db.end();
}
main().catch(function (e) { console.error('Failed:', e.message); process.exit(1); });
