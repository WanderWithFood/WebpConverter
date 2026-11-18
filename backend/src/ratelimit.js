/* Small fixed-window limiter kept in memory. Fine for one server instance.
   If the service later runs on several instances, move the counters to Redis or the database. */
const windows = new Map();

// Returns true when the call is allowed.
function consume(key, max, windowMs) {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now >= w.reset) { w = { count: 0, reset: now + windowMs }; windows.set(key, w); }
  w.count++;
  return w.count <= max;
}

setInterval(function () {
  const now = Date.now();
  windows.forEach(function (w, k) { if (now >= w.reset) windows.delete(k); });
}, 60000).unref();

module.exports = { consume };
