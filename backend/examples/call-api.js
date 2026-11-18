/* Example for the developers of a calling system (Website, Help Desk, Bug Logs Portal, ...).
   Shows how to sign a request to POST /v1/convert. Node 20 or newer, no extra packages.

     node examples/call-api.js <base-url> <api-key> <signing-secret> <image-file> [quality] [mode] [aspect]

   Signature = hex( HMAC-SHA256( signing secret, X-Timestamp + "." + the exact request body bytes ) ).
   Build the body first, sign those bytes, then send those same bytes. Each signature works once. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Returns { headers, body } ready for fetch().
async function build(key, signingSecret, fileBuffer, filename, fields, timestamp) {
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), filename);
  Object.keys(fields || {}).forEach(function (k) { form.append(k, String(fields[k])); });
  const packed = new Response(form);                       // turns the form into the exact bytes that will be sent
  const body = Buffer.from(await packed.arrayBuffer());
  const ts = String(timestamp || Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', signingSecret).update(ts + '.').update(body).digest('hex');
  return {
    body: body,
    headers: {
      'Authorization': 'Bearer ' + key,
      'X-Timestamp': ts,
      'X-Signature': signature,
      'Content-Type': packed.headers.get('content-type')
    }
  };
}

async function convert(baseUrl, key, signingSecret, fileBuffer, filename, fields) {
  const req = await build(key, signingSecret, fileBuffer, filename, fields);
  return fetch(baseUrl + '/v1/convert', { method: 'POST', headers: req.headers, body: req.body });
}

module.exports = { build, convert };

if (require.main === module) {
  const [base, key, secret, file, quality, mode, aspect] = process.argv.slice(2);
  if (!file) { console.error('Usage: node examples/call-api.js <base-url> <api-key> <signing-secret> <image-file> [quality] [mode] [aspect]'); process.exit(1); }
  const fields = {};
  if (quality) fields.quality = quality;
  if (mode) fields.mode = mode;
  if (aspect) fields.aspect = aspect;
  convert(base, key, secret, fs.readFileSync(file), path.basename(file), fields)
    .then(function (r) { return r.json().then(function (j) { console.log(r.status, JSON.stringify(j, null, 2)); }); })
    .catch(function (e) { console.error(e.message); process.exit(1); });
}
