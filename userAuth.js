import { pool } from '../db/pool.js';

/**
 * Placeholder auth for the "manage my keys" dashboard endpoints.
 * In production, replace this with real session/JWT auth and pull the user
 * id from the verified session -- this stub trusts an `x-user-email` header
 * only so the rest of the system (key CRUD, usage lookups) has something
 * concrete to plug into. Do not ship this header-trust version.
 */
export async function userAuth(req, res, next) {
  const email = req.get('x-user-email');
  if (!email) {
    return res.status(401).json({ error: 'missing_user', message: 'Send x-user-email header (replace with real auth in production).' });
  }

  const { rows } = await pool.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email, plan_id`,
    [email]
  );

  req.user = rows[0];
  next();
}
