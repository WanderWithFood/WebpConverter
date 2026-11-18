const db = require('./db');
const { HttpError } = require('./errors');

const RULES = [
  ['maxMb', 'Maximum file size', 1, 100],
  ['maxFiles', 'Files per batch', 1, 100],
  ['defq', 'Default quality', 10, 100],
  ['retain', 'Log retention (days)', 7, 365]
];

let cache = null, cachedAt = 0;

async function get() {
  if (cache && Date.now() - cachedAt < 5000) return cache;
  const r = await db.query('SELECT max_mb, max_files, default_quality, log_retention_days FROM settings WHERE id = 1');
  const s = r.rows[0];
  cache = { maxMb: s.max_mb, maxFiles: s.max_files, defq: s.default_quality, retain: s.log_retention_days };
  cachedAt = Date.now();
  return cache;
}

// Throws 400 when a value is missing or out of range. Returns clean values.
function validate(values) {
  const out = {};
  RULES.forEach(function (r) {
    const v = values && values[r[0]];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < r[2] || v > r[3]) {
      throw new HttpError(400, 'BAD_VALUES', r[1] + ' must be a whole number from ' + r[2] + ' to ' + r[3] + '.');
    }
    out[r[0]] = v;
  });
  return out;
}

async function save(client, values) {
  await client.query(
    'UPDATE settings SET max_mb=$1, max_files=$2, default_quality=$3, log_retention_days=$4 WHERE id=1',
    [values.maxMb, values.maxFiles, values.defq, values.retain]
  );
  cache = null;
}

module.exports = { get, validate, save, RULES };
