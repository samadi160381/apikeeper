-- Enable UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Plans define quota, rate limit, and overage pricing.
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,           -- e.g. 'free', 'pro', 'enterprise'
  monthly_quota   INTEGER NOT NULL,           -- included requests per billing period
  rate_limit_rpm  INTEGER NOT NULL,           -- requests per minute, per key
  price_cents     INTEGER NOT NULL DEFAULT 0, -- base subscription price
  overage_cents_per_1k INTEGER NOT NULL DEFAULT 0 -- cost per 1000 requests over quota
);

INSERT INTO plans (id, monthly_quota, rate_limit_rpm, price_cents, overage_cents_per_1k) VALUES
  ('free',       1000,    30,   0,   0),
  ('pro',       50000,   300, 4900, 200),
  ('enterprise', 1000000, 2000, 49900, 100)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT UNIQUE NOT NULL,
  plan_id           TEXT NOT NULL REFERENCES plans(id) DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only a hash of the key is ever stored. key_prefix is the short, safe-to-display
-- part shown in dashboards, e.g. "sk_live_ab12cd**************".
CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Default key',
  key_hash      TEXT UNIQUE NOT NULL,   -- sha256 hex digest of the raw key
  key_prefix    TEXT NOT NULL,          -- first ~12 chars, for display/identification
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['read'],
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Durable, per-billing-period usage counters. This is the source of truth for
-- quota checks and billing -- Redis is only used for short-window rate limiting.
CREATE TABLE IF NOT EXISTS usage_counters (
  key_id        UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  period        TEXT NOT NULL, -- 'YYYY-MM', e.g. '2026-07'
  request_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, period)
);

-- Optional daily rollup for usage graphs / analytics dashboards.
CREATE TABLE IF NOT EXISTS usage_daily (
  key_id        UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
