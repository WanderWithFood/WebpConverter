/* System keys. One live key per calling system, rotated every 90 days and on demand.
   A key looks like  <8 hex>.<64 hex>.  The first part is public and finds the record.
   Only a SHA-256 hash of the secret part is stored, and the key is shown once, when it is created.
   The signing secret that goes with it is derived from MASTER_SECRET, so it is not stored either. */
const cfg = require('./config');
const { nextId } = require('./ids');
const { publicId, randomHex, sha256, signingSecretFor } = require('./crypto');

// Creates a new key for a system and revokes the old one. Returns the key and signing secret (shown once).
async function rotate(client, systemId) {
  await client.query('UPDATE api_keys SET revoked_at = now() WHERE system_id = $1 AND revoked_at IS NULL', [systemId]);
  const keyId = randomHex(4);
  const secret = randomHex(32);
  const composite = await nextId(client, 'KEY');
  await client.query(
    "INSERT INTO api_keys (public_id, composite_id, system_id, key_id, key_hash, hint, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)",
    [publicId(), composite, systemId, keyId, sha256(secret), secret.slice(-4), String(cfg.keyDays)]
  );
  return { id: composite, key: keyId + '.' + secret, signingSecret: signingSecretFor(keyId) };
}

module.exports = { rotate };
