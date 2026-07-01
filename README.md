# API Key System

A self-hosted API key management system with per-key rate limiting and
usage-based billing, built on Node/Express, PostgreSQL, and Redis.

## How it fits together

- **Postgres** is the source of truth: keys (hashed), plans, and durable
  monthly usage counters that drive billing.
- **Redis** only handles the short-lived, high-frequency sliding-window rate
  limit (requests/minute). It’s disposable — losing it just resets the
  rate-limit window, it never affects billing.
- **Stripe** (optional) is used to sync metered usage for invoicing, via
  `reportUsageToStripe()` — call this from a periodic job (cron/hourly), not
  per-request.

## Setup

```bash
cp .env.example .env       # fill in real values
docker compose up -d       # starts Postgres + Redis locally
npm install
npm run migrate            # creates tables + seeds default plans
npm start
```

## Managing keys (dashboard endpoints)

These are meant to sit behind your app’s normal login. The `x-user-email`
header is a placeholder — replace `src/middleware/userAuth.js` with real
session/JWT auth before shipping.

```bash
# Create a key
curl -X POST http://localhost:3000/dashboard/keys \
  -H "x-user-email: dev@example.com" \
  -H "Content-Type: application/json" \
  -d '{"name": "Production key", "scopes": ["read", "write"]}'
# -> { "id": "...", "key": "sk_live_XXXXXXXX...", ... }  <-- shown once, save it

# List keys (raw key is never shown again, only the prefix)
curl http://localhost:3000/dashboard/keys -H "x-user-email: dev@example.com"

# Revoke a key
curl -X DELETE http://localhost:3000/dashboard/keys/<id> -H "x-user-email: dev@example.com"

# Check usage + estimated overage cost this billing period
curl http://localhost:3000/dashboard/usage -H "x-user-email: dev@example.com"
```

## Calling the protected API (what your consumers do)

```bash
curl http://localhost:3000/v1/ping \
  -H "Authorization: Bearer sk_live_XXXXXXXX..."
```

Every response includes rate-limit and usage headers:

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 299
X-Usage-Period: 2026-07
X-Usage-Count: 4821
X-Usage-Quota: 50000
```

## Plans (edit in `src/db/schema.sql` or the `plans` table directly)

|Plan      |Quota/mo |Rate limit|Price  |Overage         |
|----------|---------|----------|-------|----------------|
|free      |1,000    |30 rpm    |$0     |hard-capped     |
|pro       |50,000   |300 rpm   |$49/mo |$2.00 / 1k extra|
|enterprise|1,000,000|2000 rpm  |$499/mo|$1.00 / 1k extra|

Plans with `overage_cents_per_1k = 0` are hard-capped: requests are rejected
with `402 quota_exceeded` once the quota is hit. Plans with a nonzero
overage price let requests through past quota and bill for the extra usage.

## Adding a new protected endpoint

```js
import { apiKeyAuth } from './middleware/apiKeyAuth.js';

router.get('/your-endpoint', apiKeyAuth(['read']), (req, res) => {
  // req.apiKey = { id, userId, planId, scopes, overQuota }
  res.json({ ok: true });
});
```

## Security notes

- Raw keys are never stored — only a SHA-256 hash, same as password storage.
  If the database leaks, keys can’t be reconstructed from it.
- Show the raw key to the user exactly once, at creation/rotation time.
- Use `sk_live_...` / `sk_test_...` prefixes if you want separate
  test/production keys — just pass the env to `generateApiKey()`.
- Put this behind HTTPS. An API key sent over plain HTTP is as good as public.