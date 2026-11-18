/* Converted files are kept only so the caller can fetch them through a signed link that expires in 15 minutes.
   Original files are never written to disk; they exist in memory only while the conversion runs. */
const fs = require('fs');
const path = require('path');
const express = require('express');
const cfg = require('./config');
const { linkSignature, safeEqual } = require('./crypto');

const router = express.Router();
const ID = /^[A-Za-z0-9_-]{16}$/;

function filePath(id) { return path.join(cfg.storageDir, id + '.webp'); }

async function save(id, data) {
  await fs.promises.mkdir(cfg.storageDir, { recursive: true });
  await fs.promises.writeFile(filePath(id), data, { mode: 0o600 });
}

function link(id) {
  const exp = Math.floor(Date.now() / 1000) + cfg.linkSeconds;
  return {
    url: cfg.publicUrl + '/files/' + id + '.webp?exp=' + exp + '&sig=' + linkSignature(id, exp),
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

router.get('/files/:name', function (req, res) {
  res.set('Cache-Control', 'private, no-store');
  const m = /^([A-Za-z0-9_-]{16})\.webp$/.exec(req.params.name);
  const exp = Number(req.query.exp), sig = String(req.query.sig || '');
  if (!m || !ID.test(m[1]) || !isFinite(exp) || Math.floor(Date.now() / 1000) > exp || !safeEqual(linkSignature(m[1], exp), sig)) {
    return res.status(403).json({ system: 'WPC', error: 'Link is not valid or has expired.', code: 'LINK_EXPIRED' });
  }
  const p = filePath(m[1]);
  fs.stat(p, function (err) {
    if (err) return res.status(404).json({ system: 'WPC', error: 'File is no longer available.', code: 'GONE' });
    res.type('image/webp').set('X-Content-Type-Options', 'nosniff').set('Content-Disposition', 'inline; filename="converted.webp"');
    fs.createReadStream(p).pipe(res);
  });
});

// Deletes converted files older than the link lifetime (plus a short grace period).
async function sweep() {
  let names;
  try { names = await fs.promises.readdir(cfg.storageDir); } catch (e) { return; }
  const limit = Date.now() - (cfg.linkSeconds + 60) * 1000;
  for (const n of names) {
    if (!/\.webp$/.test(n)) continue;
    const p = path.join(cfg.storageDir, n);
    try { const st = await fs.promises.stat(p); if (st.mtimeMs < limit) await fs.promises.unlink(p); } catch (e) {}
  }
}

module.exports = { router, save, link, sweep };
