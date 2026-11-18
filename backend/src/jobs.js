/* Housekeeping: expired sessions and signatures, old converted files, and activity older than the retention setting. */
const db = require('./db');
const files = require('./files');
const settings = require('./settings');

async function everyMinute() {
  await db.query('DELETE FROM used_signatures WHERE expires_at < now()');
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await files.sweep();
}

async function applyRetention() {
  const s = await settings.get();
  const days = String(s.retain);
  await db.query("DELETE FROM activity WHERE occurred_at < now() - ($1 || ' days')::interval", [days]);
  await db.query("DELETE FROM conversions WHERE created_at < now() - ($1 || ' days')::interval", [days]);
}

function start() {
  const safe = function (fn, name) {
    return function () { fn().catch(function (e) { console.error('Job ' + name + ' failed:', e.message); }); };
  };
  const a = safe(everyMinute, 'cleanup'), b = safe(applyRetention, 'retention');
  a(); b();
  const t1 = setInterval(a, 60 * 1000), t2 = setInterval(b, 60 * 60 * 1000);
  t1.unref(); t2.unref();
  return function stop() { clearInterval(t1); clearInterval(t2); };
}

module.exports = { start, everyMinute, applyRetention };
