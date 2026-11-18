const path = require('path');
const express = require('express');
const cfg = require('./config');
const db = require('./db');
const { HttpError } = require('./errors');
const sessions = require('./session');
const jobs = require('./jobs');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  // HTTPS only outside local development.
  app.use(function (req, res, next) {
    if (cfg.production) {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      if (!req.secure) return res.redirect(301, cfg.publicUrl + req.originalUrl);
    }
    next();
  });
  app.use(function (req, res, next) {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"
    });
    next();
  });

  app.get('/healthz', function (req, res) { res.json({ ok: true }); });

  // Machine API (own key and signature, no cookies) and signed download links.
  app.use(require('./convert'));
  app.use(require('./files').router);

  // Everything below can use the signed-in session.
  app.use(sessions.load);
  app.use(require('./auth'));
  app.use(require('./admin'));

  // Public pages: only the sign-in page and its style. The app itself needs a valid session.
  const publicFiles = { '/login.html': 1, '/css/style.css': 1, '/js/login.js': 1 };
  app.use(function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/' || req.path === '/index.html' || !publicFiles[req.path]) {
      if (!req.user) return req.path === '/' || req.path.endsWith('.html') ? res.redirect('/login.html') : res.status(401).json({ error: 'Sign in required.', code: 'NO_SESSION' });
    }
    next();
  });
  app.use(express.static(cfg.frontendDir, { index: 'index.html', dotfiles: 'deny', maxAge: 0 }));

  app.use(function (req, res, next) { next(new HttpError(404, 'NOT_FOUND', 'Not found.')); });

  // Errors. API callers always get JSON naming the system, never a stack trace.
  app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);
    let status = err.status || 500, code = err.code, message = err.message;
    if (err.type === 'entity.parse.failed') { status = 400; code = 'BAD_REQUEST'; message = 'Invalid request body.'; }
    if (status >= 500) { console.error(err); message = 'Something went wrong on the server.'; code = code || 'SERVER_ERROR'; }
    const body = { system: 'WPC', error: message, code: code || 'ERROR' };
    if (err.attemptsLeft !== undefined) body.attemptsLeft = err.attemptsLeft;
    res.status(status).json(body);
  });

  return app;
}

async function start() {
  cfg.requireDatabase();
  cfg.requireMaster();
  const app = createApp();
  const pinRow = await db.query('SELECT 1 FROM admin_pin WHERE id = 1');
  if (!pinRow.rowCount) console.warn('The system PIN is not set. The core admin must run:  npm run set-pin');
  const stop = jobs.start();
  const server = app.listen(cfg.port, function () {
    console.log('BINI Image Converter (' + cfg.appEnv + ') listening on port ' + cfg.port);
  });
  const shutdown = function () { stop(); server.close(function () { db.end().then(function () { process.exit(0); }); }); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

module.exports = { createApp, start };

if (require.main === module) {
  start().catch(function (e) { console.error('Could not start:', e.message); process.exit(1); });
}
