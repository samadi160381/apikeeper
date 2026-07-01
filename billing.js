import { pool } from '../db/pool.js';
import 'dotenv/config';

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  const { default: Stripe } = await import('stripe');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
}

/** Current billing period identifier, e.g. "2026-07". Calendar-month periods. */
export function currentPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Atomically increments the request counter for this key + period and
 * returns the new total. Postgres (not Redis) is the source of truth here
 * because usage numbers drive invoices and must survive a cache flush/restart.
 */
export async function incrementUsage(keyId) {
  const period = currentPeriod();
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO usage_counters (key_id, period, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key_id, period)
     DO UPDATE SET request_count = usage_counters.request_count + 1
     RETURNING request_count`,
    [keyId, period]
  );

  // Best-effort daily rollup for usage graphs; failures here shouldn't block the request.
  pool.query(
    `INSERT INTO usage_daily (key_id, day, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key_id, day)
     DO UPDATE SET request_count = usage_daily.request_count + 1`,
    [keyId, today]
  ).catch((err) => console.error('[billing] daily rollup failed', err));

  return rows[0].request_count;
}

/** Reads current usage for a key without incrementing it. */
export async function getUsage(keyId, period = currentPeriod()) {
  const { rows } = await pool.query(
    `SELECT request_count FROM usage_counters WHERE key_id = $1 AND period = $2`,
    [keyId, period]
  );
  return rows[0]?.request_count ?? 0;
}

/**
 * Checks whether a key has exceeded its plan's monthly quota.
 * Enterprise-style "soft" plans (overage_cents_per_1k > 0) are allowed to go
 * over quota and get billed for the overage; plans with no overage price are
 * hard-capped at the quota.
 */
export async function checkQuota(keyId, plan, usedThisPeriod) {
  const overQuota = usedThisPeriod >= plan.monthly_quota;
  const hardCapped = overQuota && plan.overage_cents_per_1k === 0;
  return {
    overQuota,
    hardCapped,
    quota: plan.monthly_quota,
    used: usedThisPeriod,
  };
}

/**
 * Reports usage to Stripe for metered billing, if configured. Call this
 * periodically (e.g. hourly cron) rather than per-request, to avoid hammering
 * the Stripe API -- Postgres already holds the durable, real-time count.
 */
export async function reportUsageToStripe(stripeSubscriptionItemId, quantity) {
  if (!stripe) {
    console.warn('[billing] Stripe not configured; skipping usage report');
    return null;
  }
  return stripe.subscriptionItems.createUsageRecord(stripeSubscriptionItemId, {
    quantity,
    timestamp: Math.floor(Date.now() / 1000),
    action: 'set', // 'set' = report an absolute total for the period, not a delta
  });
}
