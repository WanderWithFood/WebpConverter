# BINI Image Converter (WebP Converter, system code WPC)

Private internal service for the BINI team. Staff sign in, convert images to WebP in four steps (Upload, Settings, Convert, Download), and other BINI systems call a signed API.

```
frontend/   the revamped UI (plain HTML/CSS/JS), served by the backend
backend/    Node.js + Express + PostgreSQL + sharp: sign-in, settings, API keys, conversion API, activity log
```

**Important:** this cannot be hosted on GitHub Pages. Pages is public and static; this service must be private and needs a server and a database. The backend serves the frontend itself, and only the sign-in page is public.

## What is built (scope points 1 to 9)

| # | Point | Where |
|---|-------|-------|
| 1 | Revamped UI | `frontend/` |
| 2 | Four-step flow | `frontend/js/app.js` |
| 3 | Old marketing content removed | `frontend/` |
| 4 | Founders Desk sign-in (temporary allowed-users list) | `backend/src/auth.js`, `sso.js`, `scripts/add-user.js` |
| 5 | Real file checks (signature, size, pixel cap, 6 types) | `frontend/js/validate.js`, `backend/src/imaging.js` |
| 6 | `POST /v1/convert` | `backend/src/convert.js` |
| 7 | API Integrations, Activity Log, Settings pages | `frontend/js/views.js`, `backend/src/admin.js` |
| 8 | PIN, key rotation, lock + alert | `backend/src/pin.js`, `keys.js` |
| 9 | WPC ID format `WPC-IMG-000412` | `backend/src/ids.js` |

## Not built (left out of this scope)

- Point 10: MCP, Amazon SES email, Sentry. Because of that, PIN-lock and rotation alerts are written to the Activity Log only (no email).
- Point 11: acceptance checklist and security audit.
- Final Founders Desk sign-in: `src/sso.js` assumes OpenID Connect. Adjust it after the Founders Desk review. Until then access uses the **temporary allowed-users list** (`npm run add-user`).
- Open question from the docs: very large files may need server-side conversion instead of the browser tool.
- The browser tool uses canvas, so "lossless" there is only near-lossless. The API uses libvips and is truly lossless.

## Run it locally

Needs Node 20+ and PostgreSQL 14+.

```
cd backend
npm install
cp .env.example .env        # fill in DATABASE_URL and MASTER_SECRET (instructions inside)
npm run migrate             # creates tables, seeds the six systems
npm run set-pin             # the core admin sets the PIN (prompted, never typed in chat)
npm run add-user -- add you@bini.example "Your Name"
npm run break-glass         # optional: emergency admin (password + authenticator app)
npm start                   # http://localhost:3000
```

For local testing without Founders Desk, set `DEV_LOGIN=true` and open `/auth/dev-login?email=you@bini.example`. This is ignored when `NODE_ENV=production`.

### Tests

```
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/wpc_test npm test
```

48 end-to-end tests against a real database. **They wipe the `public` schema of that database; use an empty test database only.**

## Deploying

- Run Stage and Production as separate deployments with separate databases and separate secrets. Never share keys, PINs or `MASTER_SECRET` between them.
- Put secrets in the host's secrets store, not in the repo. `.env` is git-ignored.
- Serve over HTTPS only (production redirects HTTP and sends HSTS). Set `TRUST_PROXY` to the number of proxies in front.
- Run `npm run migrate` on each release (it is safe to repeat).
- Rate limiting is in memory: fine for one instance. For several instances move the counters to Redis or the database.
- Back up the database. Originals are never stored; converted files are deleted after 15 minutes.

## API for other BINI systems

`POST /v1/convert`, multipart form: `file` (required), `quality` 10-100 (default 75), `mode` lossy|lossless, `aspect` original|16:9|9:16|1:1.

Headers:
- `Authorization: Bearer <api key>`
- `X-Timestamp: <unix seconds>` (must be within 5 minutes)
- `X-Signature: hex(HMAC-SHA256(signing secret, timestamp + "." + exact body bytes))`. Each signature works once.

Success: `{ system, type, id, requested_by, format, bytes_in, bytes_out, url, expires_at }`. The `url` is a signed link valid for 15 minutes.
Errors: 400 bad request, 401 bad key/signature/time/replay, 413 too large, 415 not an allowed image, 429 rate limit, 504 timeout.

Working client: `backend/examples/call-api.js`.

Keys are created or rotated on the API Integrations page (PIN required). The key and signing secret are shown once and only hashes are stored. Keys expire after 90 days; rotating retires the old key immediately. Share keys with developers through the team's secrets store, never by chat or email.

## PIN rules

Own PIN per core admin setup, stored as a salted slow hash. 3 wrong tries lock PIN-protected actions (settings, key rotation) for 15 minutes and add an alert entry to the Activity Log. Invalid setting values are rejected before the PIN is checked, so they do not use an attempt.
