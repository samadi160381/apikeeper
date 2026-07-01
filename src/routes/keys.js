import { Router } from 'express';
import { pool } from '../db/pool.js';
import { generateApiKey, hashApiKey, keyPrefix } from '../lib/keys.js';
import { userAuth } from '../middleware/userAuth.js';

export const keysRouter = Router();

keysRouter.use(userAuth);

// Create a new API key for the logged-in user.
keysRouter.post('/', async (req, res) => {
  const { name = 'Default key', scopes = ['read'], expires_at = null } = req.body || {};

  const rawKey = generateApiKey();
  const key_hash = hashApiKey(rawKey);
  const prefix = keyPrefix(rawKey);

  const { rows } = await pool.query(
    `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, key_prefix, scopes, status, created_at, expires_at`,
    [req.user.id, name, key_hash, prefix, scopes, expires_at]
  );

  // The raw key is returned exactly once. It cannot be retrieved again.
  res.status(201).json({ ...rows[0], key: rawKey });
});

// List keys (never returns the raw key or hash, only the safe prefix).
keysRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, key_prefix, scopes, status, created_at, last_used_at, expires_at
     FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// Revoke a key (soft delete -- keeps usage history intact for billing records).
keysRouter.delete('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE api_keys SET status = 'revoked'
     WHERE id = $1 AND user_id = $2
     RETURNING id, status`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

// Rotate a key: revoke the old one, issue a new one with the same settings.
keysRouter.post('/:id/rotate', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT name, scopes FROM api_keys WHERE id = $1 AND user_id = $2 AND status = 'active'`,
    [req.params.id, req.user.id]
  );
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'not_found' });

  await pool.query(`UPDATE api_keys SET status = 'revoked' WHERE id = $1`, [req.params.id]);

  const rawKey = generateApiKey();
  const key_hash = hashApiKey(rawKey);
  const prefix = keyPrefix(rawKey);

  const { rows: created } = await pool.query(
    `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, scopes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, key_prefix, scopes, status, created_at`,
    [req.user.id, existing.name, key_hash, prefix, existing.scopes]
  );

  res.status(201).json({ ...created[0], key: rawKey });
});
