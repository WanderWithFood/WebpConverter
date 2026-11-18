const { nextId } = require('./ids');
const { publicId } = require('./crypto');

/* Writes one activity entry (WPC-ACT-...). Only names, counts and sizes are logged. Image content is never stored.
   client: a pg client inside a transaction, or the pool. */
async function log(client, e) {
  const id = await nextId(client, 'ACT');
  await client.query(
    'INSERT INTO activity (public_id, composite_id, actor, kind, detail, size_change, result, ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [publicId(), id, e.actor, e.kind, e.detail, e.size || '', e.result, e.ref || null]
  );
  return id;
}

function mb(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(1) + ' KB';
}

module.exports = { log, mb };
