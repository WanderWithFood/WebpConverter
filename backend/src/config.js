const fs = require('fs');
const path = require('path');

// Tiny .env loader for local use. Real environments use the host's secrets store.
(function loadEnvFile() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
    if (/^\s*#/.test(line)) return;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) return;
    let v = m[2].replace(/\s+#.*$/, '');
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
})();

const env = process.env;
const production = env.NODE_ENV === 'production';
const num = function (v, d) { const n = Number(v); return v !== undefined && v !== '' && isFinite(n) ? n : d; };

const cfg = {
  production: production,
  appEnv: env.APP_ENV || (production ? 'production' : 'development'),
  port: num(env.PORT, 3000),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL === 'true',
  masterSecret: env.MASTER_SECRET,
  storageDir: path.resolve(env.STORAGE_DIR || path.join(__dirname, '..', 'tmp-output')),
  frontendDir: path.resolve(env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend')),
  sso: {
    authorizeUrl: env.SSO_AUTHORIZE_URL,
    tokenUrl: env.SSO_TOKEN_URL,
    userinfoUrl: env.SSO_USERINFO_URL,
    clientId: env.SSO_CLIENT_ID,
    clientSecret: env.SSO_CLIENT_SECRET,
    scope: env.SSO_SCOPE || 'openid email profile'
  },
  devLogin: env.DEV_LOGIN === 'true' && !production,
  trustProxy: num(env.TRUST_PROXY, 0),
  sessionHours: num(env.SESSION_HOURS, 8),
  apiRatePerMin: num(env.API_RATE_PER_MIN, 60),
  userRatePerMin: num(env.USER_RATE_PER_MIN, 120),
  convertConcurrency: num(env.CONVERT_CONCURRENCY, 2),
  convertTimeoutSeconds: num(env.CONVERT_TIMEOUT_SECONDS, 30),
  maxPixels: num(env.MAX_PIXELS, 100000000),
  // fixed rules from the Scope of Work
  timestampWindowSeconds: 300,
  linkSeconds: 15 * 60,
  keyDays: 90,
  pinLockMinutes: 15,
  pinMaxAttempts: 3
};

cfg.requireMaster = function () {
  if (!cfg.masterSecret || cfg.masterSecret.length < 32) {
    throw new Error('MASTER_SECRET must be set to at least 32 characters.');
  }
};
cfg.requireDatabase = function () {
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL is not set.');
};

module.exports = cfg;
