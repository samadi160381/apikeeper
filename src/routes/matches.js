import { Router } from 'express';
import { pool } from '../db/pool.js';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';

export const matchesRouter = Router();

// --- Public: consumers (like ScorePulse) call this with their API key. ---
matchesRouter.get('/matches', apiKeyAuth(['read']), async (req, res) => {
  const { status, competition } = req.query;
  const conditions = [];
  const values = [];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  if (competition) {
    values.push(competition);
    conditions.push(`competition = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT id, home_team, away_team, home_score, away_score, status, match_date, competition
     FROM matches ${where}
     ORDER BY match_date DESC
     LIMIT 100`,
    values
  );

  res.json({ matches: rows });
});

// --- Admin only: you update scores here. Protected by a shared secret header. ---
function requireAdmin(req, res, next) {
  const token = req.header('x-admin-token');
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Create a new match
matchesRouter.post('/admin/matches', requireAdmin, async (req, res) => {
  const { home_team, away_team, home_score, away_score, status, match_date, competition } = req.body || {};

  if (!home_team || !away_team || !match_date) {
    return res.status(400).json({ error: 'home_team, away_team, and match_date are required' });
  }

  const { rows } = await pool.query(
    `INSERT INTO matches (home_team, away_team, home_score, away_score, status, match_date, competition)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [home_team, away_team, home_score ?? null, away_score ?? null, status || 'scheduled', match_date, competition || null]
  );

  res.status(201).json(rows[0]);
});

// Update an existing match (e.g. update the live score)
matchesRouter.put('/admin/matches/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { home_score, away_score, status } = req.body || {};

  const { rows } = await pool.query(
    `UPDATE matches
     SET home_score = COALESCE($1, home_score),
         away_score = COALESCE($2, away_score),
         status = COALESCE($3, status),
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [home_score ?? null, away_score ?? null, status ?? null, id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

