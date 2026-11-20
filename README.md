# BINI Image Converter

**System code:** `WPC` · **Status:** Internal, private service · **Stack:** Node.js 20 · Express · PostgreSQL · sharp (libvips)

BINI Image Converter turns team images into optimised WebP files. Signed-in staff use a four-step web flow (Upload → Settings → Convert → Download), and other BINI systems call a signed HTTP API to convert images automatically.

> **Hosting note:** this is a server application with a database and sign-in. It **cannot** run on GitHub Pages (public, static only). It must be deployed to a server that runs Node.js and PostgreSQL behind HTTPS.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)
- [API for BINI systems](#api-for-bini-systems)
- [Security model](#security-model)
- [Scope and roadmap](#scope-and-roadmap)

---

## Features

| Area | What it does |
|------|--------------|
| Web converter | Four-step flow, batch upload, quality 10–100, lossy / lossless, aspect ratio (original, 16:9, 9:16, 1:1), ZIP download |
| File validation | Real signature checks (not just extensions), size limit, pixel cap, six allowed image types |
| Conversion API | `POST /v1/convert` with HMAC-signed requests, single-use signatures, signed 15-minute download links |
| Admin pages | API Integrations (create / rotate keys), Activity Log, Settings |
| Protection | Admin PIN with lockout after 3 wrong tries, 90-day key expiry, rate limiting, strict security headers |
| Sign-in | Founders Desk single sign-on (OpenID Connect) with a temporary allowed-users list and a break-glass admin |
| Records | Readable IDs such as `WPC-IMG-000412`; IDs are never reused |

## Architecture

```
 Browser (staff)  ──HTTPS──►  ┌──────────────────────────────┐
                              │  Node.js / Express backend    │
 BINI systems  ──signed API──►│  • serves frontend/ (static)  │──► PostgreSQL
                              │  • auth, sessions, admin      │
                              │  • sharp/libvips conversion   │──► STORAGE_DIR (temp, 15 min)
                              └──────────────────────────────┘
```

- The backend serves the frontend itself. Only the sign-in page is public; everything else requires a session.
- Original uploads are never stored. Converted files are deleted after 15 minutes.

## Repository layout

```
backend/
  src/            Express app: server, auth, sso, sessions, convert, keys, pin, admin, activity
  scripts/        migrate, set-pin, add-user, break-glass
  sql/schema.sql  database schema (safe to re-run)
  test/run.js     end-to-end test suite
  examples/       working API client (call-api.js)
frontend/
  index.html, login.html, css/, js/   the web app (plain HTML/CSS/JS)

index.html, script.js, style.css,     legacy client-only converter (v1).
WebpConverter-main/                    Kept for reference; not used by the new service.
```

## Requirements

- Node.js **20+**
- PostgreSQL **14+**
- A reverse proxy providing HTTPS in Stage / Production (e.g. Nginx or a load balancer)

## Local development

```bash
cd backend
npm install
cp .env.example .env          # set DATABASE_URL and MASTER_SECRET (instructions inside)
npm run migrate               # creates tables and seeds the systems
npm run set-pin               # core admin sets the PIN (interactive prompt)
npm run add-user -- add you@bini.example "Your Name"
npm run break-glass           # optional: emergency admin (password + authenticator app)
npm start                     # http://localhost:3000
```

Without Founders Desk, set `DEV_LOGIN=true` in `.env` and open
`http://localhost:3000/auth/dev-login?email=you@bini.example`. This is ignored when `NODE_ENV=production`.

Health check: `GET /healthz` → `{ "ok": true }`

## Configuration

All settings are environment variables; see [`backend/.env.example`](backend/.env.example) for the full list.

| Variable | Purpose |
|----------|---------|
| `NODE_ENV`, `APP_ENV` | `production` / `stage` / `development` |
| `PORT`, `PUBLIC_URL` | Listening port and the public HTTPS address (no trailing slash) |
| `DATABASE_URL`, `DATABASE_SSL` | PostgreSQL connection |
| `MASTER_SECRET` | ≥ 32 random characters; signs links, derives API secrets, encrypts 2FA secret |
| `SSO_*` | Founders Desk OpenID Connect settings |
| `TRUST_PROXY` | Number of proxies in front of the app |
| `API_RATE_PER_MIN`, `USER_RATE_PER_MIN` | Rate limits |
| `CONVERT_CONCURRENCY`, `CONVERT_TIMEOUT_SECONDS`, `MAX_PIXELS` | Conversion limits |
| `STORAGE_DIR` | Temporary output folder |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Never commit `.env`. In Stage and Production, keep secrets in the server's secret store.

## Testing

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/wpc_test npm test
```

48 end-to-end tests run against a real database.
⚠️ **The suite wipes the `public` schema of that database — use an empty, dedicated test database.**

## Deployment

Example for a Linux server (Ubuntu) with Nginx and PM2:

```bash
# 1. System packages
sudo apt install -y nodejs npm postgresql nginx
sudo npm install -g pm2

# 2. Database
sudo -u postgres createuser wpc -P
sudo -u postgres createdb wpc -O wpc

# 3. Code
git clone <repo-url> /opt/wpc && cd /opt/wpc/backend
npm ci --omit=dev
cp .env.example .env && nano .env      # NODE_ENV=production, PUBLIC_URL=https://..., secrets
npm run migrate
npm run set-pin
npm run add-user -- add admin@bini.example "Admin"

# 4. Run
pm2 start src/server.js --name wpc && pm2 save && pm2 startup
```

Nginx (HTTPS via Certbot):

```nginx
server {
    server_name converter.example.com;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d converter.example.com
```

**Updating a release**

```bash
cd /opt/wpc && git pull
cd backend && npm ci --omit=dev && npm run migrate
pm2 restart wpc
```

**Production checklist**

- Stage and Production are separate deployments with separate databases and secrets.
- HTTPS only (production redirects HTTP and sends HSTS); set `TRUST_PROXY` correctly.
- Run `npm run migrate` on every release (idempotent).
- Rate limiting is in memory — fine for one instance; move counters to Redis/DB before scaling out.
- Back up the database regularly.

## API for BINI systems

`POST /v1/convert` — `multipart/form-data`

| Field | Required | Values |
|-------|----------|--------|
| `file` | yes | image file |
| `quality` | no | 10–100 (default 75) |
| `mode` | no | `lossy` \| `lossless` |
| `aspect` | no | `original` \| `16:9` \| `9:16` \| `1:1` |

Headers:

```
Authorization: Bearer <api key>
X-Timestamp:   <unix seconds, within 5 minutes>
X-Signature:   hex(HMAC-SHA256(signing_secret, timestamp + "." + raw_body_bytes))
```

Each signature can be used only once.

Success response:

```json
{ "system": "...", "type": "IMG", "id": "WPC-IMG-000412", "requested_by": "...",
  "format": "webp", "bytes_in": 120394, "bytes_out": 40211,
  "url": "https://.../files/...", "expires_at": "..." }
```

Errors: `400` bad request · `401` bad key / signature / time / replay · `413` too large · `415` not an allowed image · `429` rate limit · `504` timeout.

A working client is in [`backend/examples/call-api.js`](backend/examples/call-api.js).

## Security model

- **API keys** are created or rotated on the API Integrations page (PIN required). Key and signing secret are shown once; only hashes are stored. Keys expire after 90 days; rotation retires the old key immediately.
- **Admin PIN** is stored as a salted slow hash. Three wrong attempts lock PIN-protected actions for 15 minutes and log an alert. Invalid setting values are rejected before the PIN is checked.
- **Headers:** strict Content-Security-Policy, `frame-ancestors 'none'`, HSTS in production.
- **Data:** originals never stored; outputs deleted after 15 minutes; EXIF metadata stripped.
- Share keys only through the team's secrets store — never by chat or email.

## Scope and roadmap

Delivered (scope points 1–9): revamped UI, four-step flow, legacy marketing content removed, Founders Desk sign-in with allowed-users list, real file checks, `POST /v1/convert`, admin pages, PIN / key rotation / lockout, WPC ID format.

Not yet built:

- **Point 10:** MCP, Amazon SES email alerts, Sentry (alerts currently go to the Activity Log only).
- **Point 11:** acceptance checklist and security audit.
- Final Founders Desk SSO wiring (`src/sso.js` assumes OpenID Connect).
- Browser tool "lossless" is near-lossless (canvas); the API is truly lossless (libvips).

---

© BINI. Internal use only.
