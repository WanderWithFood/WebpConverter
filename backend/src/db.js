const { Pool } = require('pg');
const cfg = require('./config');

let pool;
function get() {
  if (!pool) {
    cfg.requireDatabase();
    pool = new Pool({
      connectionString: cfg.databaseUrl,
      max: 10,
      ssl: cfg.databaseSsl ? { rejectUnauthorized: true } : undefined
    });
    pool.on('error', function (e) { console.error('Database pool error:', e.message); });
  }
  return pool;
}

module.exports = {
  query: function (text, params) { return get().query(text, params); },
  // Runs fn inside a transaction. Commits when fn returns, rolls back when it throws.
  tx: async function (fn) {
    const client = await get().connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  },
  end: async function () { if (pool) { await pool.end(); pool = null; } }
};
