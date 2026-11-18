/* Founders Desk single sign-on.
   ASSUMPTION: Founders Desk offers OpenID Connect (authorization code with PKCE). The scope document says the final
   single sign-on design waits for the Founders Desk review, so everything that depends on that protocol is in this file.
   Change only this file if Founders Desk uses something else (for example SAML or a custom token). */
const crypto = require('crypto');
const cfg = require('./config');
const { HttpError } = require('./errors');
const { cookieSignature, safeEqual, randomToken } = require('./crypto');
const sessions = require('./session');

const STATE_COOKIE = 'bini_oidc';

function configured() {
  const s = cfg.sso;
  return !!(s.authorizeUrl && s.tokenUrl && s.userinfoUrl && s.clientId && s.clientSecret);
}

function redirectUri() { return cfg.publicUrl + '/auth/callback'; }

// Step 1: send the person to Founders Desk.
function start(req, res) {
  if (!configured()) throw new HttpError(503, 'SSO_NOT_CONFIGURED', 'Founders Desk sign-in is not configured yet.');
  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const payload = Buffer.from(JSON.stringify({ s: state, v: verifier, e: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  res.append('Set-Cookie', sessions.cookieString(STATE_COOKIE, payload + '.' + cookieSignature(payload), 600));
  const q = new URLSearchParams({
    response_type: 'code', client_id: cfg.sso.clientId, redirect_uri: redirectUri(),
    scope: cfg.sso.scope, state: state, code_challenge: challenge, code_challenge_method: 'S256'
  });
  res.redirect(cfg.sso.authorizeUrl + (cfg.sso.authorizeUrl.indexOf('?') > -1 ? '&' : '?') + q.toString());
}

// Step 2: Founders Desk sends the person back with a code. Returns { email, name }.
async function finish(req) {
  const raw = sessions.parseCookies(req)[STATE_COOKIE] || '';
  const dot = raw.lastIndexOf('.');
  const payload = raw.slice(0, dot), sig = raw.slice(dot + 1);
  if (!payload || !safeEqual(cookieSignature(payload), sig)) throw new HttpError(400, 'BAD_STATE', 'Sign-in session expired. Start again.');
  const st = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (Date.now() > st.e || !req.query.state || !safeEqual(st.s, req.query.state)) throw new HttpError(400, 'BAD_STATE', 'Sign-in session expired. Start again.');
  if (!req.query.code) throw new HttpError(400, 'NO_CODE', 'Sign-in was not completed.');

  const tokenRes = await fetch(cfg.sso.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(),
      client_id: cfg.sso.clientId, client_secret: cfg.sso.clientSecret, code_verifier: st.v
    }),
    signal: AbortSignal.timeout(10000)
  });
  const tok = await tokenRes.json().catch(function () { return {}; });
  if (!tokenRes.ok || !tok.access_token) throw new HttpError(401, 'SSO_FAILED', 'Founders Desk did not accept the sign-in.');

  const infoRes = await fetch(cfg.sso.userinfoUrl, {
    headers: { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  const info = await infoRes.json().catch(function () { return {}; });
  if (!infoRes.ok || !info.email) throw new HttpError(401, 'SSO_FAILED', 'Founders Desk did not return an email address.');
  if (info.email_verified === false) throw new HttpError(401, 'SSO_FAILED', 'Email address is not verified in Founders Desk.');
  return { email: String(info.email).toLowerCase(), name: String(info.name || info.email) };
}

function clearState(res) { res.append('Set-Cookie', sessions.cookieString(STATE_COOKIE, '', 0)); }

module.exports = { configured, start, finish, clearState };
