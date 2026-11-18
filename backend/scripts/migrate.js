/* Creates the tables and the six calling systems. Safe to run again. */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { publicId } = require('../src/crypto');

const SYSTEMS = [
  ['WEB', 'BINI Website'],
  ['FDK', 'Founders Desk'],
  ['HLP', 'Help Desk'],
  ['CMP', 'Campaign Management'],
  ['BLG', 'Bug Logs Portal'],
  ['W2F', 'Wander With Food']
];

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await db.query(sql);
  for (const s of SYSTEMS) {
    await db.query('INSERT INTO systems (public_id, code, name) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [publicId(), s[0], s[1]]);
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate().then(function () { console.log('Database ready.'); return db.end(); })
    .catch(function (e) { console.error('Migration failed:', e.message); process.exit(1); });
}
