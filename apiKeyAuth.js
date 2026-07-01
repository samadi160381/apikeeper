import { pool } from '../db/pool.js';
import { hashApiKey } from '../lib/keys.js';
import { checkRateLimit } from '../lib/rateLimiter.js';
import { incrementUsage, getUsage, checkQuota, currentPeriod } from '../lib/billing.js';

/**
 * Validates the API key on every incoming request, enforces per-minute rate
 * limits and monthly quota, and attaches usage info to the response headers
 * -- the same pattern GitHub/Stripe/OpenAI use.
 *
 * Usage: app.use('/v1', apiKeyAuth(['read']))
 */
export function apiKeyAuth(requiredScopes = []) {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization') || '';
      const rawKey = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

      if (!rawKey) {
        return res.status(401).json({ error: 'missing_api_key', message: 'Provide your key as: Authorization: Bearer <key>' });
      }

      const keyHash = hashApiKey(rawKey);

      const { rows } = await pool.query(
        `SELECT ak.id, ak.status, ak.scopes, ak.expires_at,
                u.id AS user_id, u.plan_id,
                p.monthly_quota, p.rate_limit_rpm, p.overage_cents_per_1k
         FROM api_keys ak
         JOIN users u ON u.id = ak.user_id
         JOIN plans p ON p.id = u.plan_id
         WHERE ak.key_hash = $1`,
        [keyHash]
      );

      const record = rows[0];
      if (!record) {
        return res.status(401).json({ error: 'invalid_api_key' });
      }
      if (record.status !== 'active') {
        return res.status(401).json({ error: 'key_revoked' });
      }
      if (record.expires_at && new Date(record.expires_at) < new Date()) {
        return res.status(401).json({ error: 'key_expired' });
      }

      const missingScope = requiredScopes.find((s) => !record.scopes.includes(s));
      if (missingScope) {
        return res.status(403).json({ error: 'insufficient_scope', required: missingScope });
      }

      // 1. Short-window rate limit (protects against bursts / abuse).
      const rl = await checkRateLimit(record.id, record.rate_limit_rpm);
      res.set('X-RateLimit-Limit', String(rl.limit));
      res.set('X-RateLimit-Remaining', String(rl.remaining));
      if (!rl.allowed) {
        res.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
        return res.status(429).json({ error: 'rate_limit_exceeded', retry_after_ms: rl.retryAfterMs });
      }

      // 2. Monthly quota check (drives billing, not just throttling).
      const used = await getUsage(record.id);
      const quota = await checkQuota(record.id, record, used);
      if (quota.hardCapped) {
        return res.status(402).json({
          error: 'quota_exceeded',
          message: 'Monthly request quota exceeded. Upgrade your plan to continue.',
          used: quota.used,
          quota: quota.quota,
        });
      }

      // 3. Record the request. Fire-and-forget-ish: we await it because the
      // count directly feeds billing, but it's a single indexed UPSERT so it's cheap.
      const newTotal = await incrementUsage(record.id);

      res.set('X-Usage-Period', currentPeriod());
      res.set('X-Usage-Count', String(newTotal));
      res.set('X-Usage-Quota', String(record.monthly_quota));

      pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [record.id])
        .catch((err) => console.error('[apiKeyAuth] failed to update last_used_at', err));

      req.apiKey = {
        id: record.id,
        userId: record.user_id,
        planId: record.plan_id,
        scopes: record.scopes,
        overQuota: quota.overQuota, // true if in paid overage territory
      };

      next();
    } catch (err) {
      console.error('[apiKeyAuth] unexpected error', err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
