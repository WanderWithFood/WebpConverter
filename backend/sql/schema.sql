-- BINI Image Converter (WPC) schema. Safe to run more than once.
-- Composite IDs look like WPC-IMG-000412. Internal BIGINT keys are never shown or sent.
-- Sequences are never reset, so IDs are never reused.

CREATE SEQUENCE IF NOT EXISTS wpc_img_seq;   -- conversion records
CREATE SEQUENCE IF NOT EXISTS wpc_key_seq;   -- system keys
CREATE SEQUENCE IF NOT EXISTS wpc_act_seq;   -- activity entries

CREATE TABLE IF NOT EXISTS systems (
  id          BIGSERIAL PRIMARY KEY,
  public_id   CHAR(16)  NOT NULL UNIQUE,
  code        TEXT      NOT NULL UNIQUE,
  name        TEXT      NOT NULL,
  status      TEXT      NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           BIGSERIAL PRIMARY KEY,
  public_id    CHAR(16)  NOT NULL UNIQUE,
  composite_id TEXT      NOT NULL UNIQUE,
  system_id    BIGINT    NOT NULL REFERENCES systems(id),
  key_id       TEXT      NOT NULL UNIQUE,   -- public part of the key
  key_hash     TEXT      NOT NULL,          -- SHA-256 of the secret part. The key itself is never stored.
  hint         TEXT      NOT NULL,          -- last 4 characters, for display only
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,        -- 90 days after creation
  revoked_at   TIMESTAMPTZ
);
-- one live key per system
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_live ON api_keys(system_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS conversions (
  id           BIGSERIAL PRIMARY KEY,
  public_id    CHAR(16)  NOT NULL UNIQUE,
  composite_id TEXT      NOT NULL UNIQUE,   -- WPC-IMG-000412
  system_id    BIGINT    NOT NULL REFERENCES systems(id),
  bytes_in     BIGINT    NOT NULL,
  bytes_out    BIGINT    NOT NULL,
  quality      INT       NOT NULL,
  mode         TEXT      NOT NULL,
  aspect       TEXT      NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversions_created ON conversions(created_at);

CREATE TABLE IF NOT EXISTS activity (
  id           BIGSERIAL PRIMARY KEY,
  public_id    CHAR(16)  NOT NULL UNIQUE,
  composite_id TEXT      NOT NULL UNIQUE,   -- WPC-ACT-000731
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor        TEXT      NOT NULL,          -- user name or system code
  kind         TEXT      NOT NULL CHECK (kind IN ('System', 'Staff', 'Admin')),
  detail       TEXT      NOT NULL,
  size_change  TEXT      NOT NULL DEFAULT '',
  result       TEXT      NOT NULL,
  ref          TEXT                          -- related composite ID, for example WPC-IMG-000412
);
CREATE INDEX IF NOT EXISTS activity_time  ON activity(occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_actor ON activity(kind, actor, occurred_at);

CREATE TABLE IF NOT EXISTS settings (
  id                 INT PRIMARY KEY CHECK (id = 1),
  max_mb             INT NOT NULL DEFAULT 50  CHECK (max_mb BETWEEN 1 AND 100),
  max_files          INT NOT NULL DEFAULT 50  CHECK (max_files BETWEEN 1 AND 100),
  default_quality    INT NOT NULL DEFAULT 75  CHECK (default_quality BETWEEN 10 AND 100),
  log_retention_days INT NOT NULL DEFAULT 30  CHECK (log_retention_days BETWEEN 7 AND 365)
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- The Image Converter's own PIN. Slow salted hash. Held by the core admin.
CREATE TABLE IF NOT EXISTS admin_pin (
  id              INT PRIMARY KEY CHECK (id = 1),
  pin_hash        TEXT NOT NULL,
  failed_attempts INT  NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Temporary access list until MCP grants and suspends access. This portal creates no accounts of its own;
-- a row here only says that a person who signs in through Founders Desk may enter.
CREATE TABLE IF NOT EXISTS allowed_users (
  id         BIGSERIAL PRIMARY KEY,
  public_id  CHAR(16) NOT NULL UNIQUE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS allowed_users_email ON allowed_users (lower(email));

-- The single break-glass Admin account, outside single sign-on. Password hash + encrypted 2FA secret.
CREATE TABLE IF NOT EXISTS break_glass (
  id              INT PRIMARY KEY CHECK (id = 1),
  username        TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  totp_secret_enc TEXT NOT NULL,
  failed_attempts INT  NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  sid_hash    TEXT PRIMARY KEY,             -- SHA-256 of the cookie value
  user_kind   TEXT NOT NULL CHECK (user_kind IN ('sso', 'break_glass')),
  user_id     BIGINT REFERENCES allowed_users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Signatures already used, so a repeated request is rejected.
CREATE TABLE IF NOT EXISTS used_signatures (
  signature  TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS used_signatures_exp ON used_signatures(expires_at);
