import { Router } from 'express';
import { pool } from '../db/pool.js';
import { userAuth } from '../middleware/userAuth.js';
import { currentPeriod } from '../lib/billing.js';

export const usageRouter = Router();

usageRouter.use(userAuth);

// Current-period usage + quota + estimated overage cost, across all of the user's keys.
usageRouter.get('/', async (req, res) => {
  const period = currentPeriod();

  const { rows } = await pool.query(
    `SELECT ak.id AS key_id, ak.name, ak.key_prefix,
            COALESCE(uc.request_count, 0) AS used,
            p.monthly_quota, p.overage_cents_per_1k
     FROM api_keys ak
     JOIN users u ON u.id = ak.user_id
     JOIN plans p ON p.id = u.plan_id
     LEFT JOIN usage_counters uc ON uc.key_id = ak.id AND uc.period = $2
     WHERE ak.user_id = $1
     ORDER BY ak.created_at DESC`,
    [req.user.id, period]
  );

  const withCost = rows.map((r) => {
    const overage = Math.max(r.used - r.monthly_quota, 0);
    const overageCostCents = Math.ceil((overage / 1000) * r.overage_cents_per_1k);
    return { ...r, overage, overage_cost_cents: overageCostCents };
  });

  res.json({ period, keys: withCost });
});

// Daily usage series for a single key (for charts).
usageRouter.get('/:keyId/daily', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ud.day, ud.request_count
     FROM usage_daily ud
     JOIN api_keys ak ON ak.id = ud.key_id
     WHERE ud.key_id = $1 AND ak.user_id = $2
     ORDER BY ud.day ASC
     LIMIT 90`,
    [req.params.keyId, req.user.id]
  );
  res.json(rows);
});
