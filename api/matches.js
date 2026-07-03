import pg from 'pg';
import crypto from 'crypto';

// Neon serverless Postgres over plain TCP works fine with the standard 'pg' driver.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

async function requireApiKey(req, res) {
  const header = req.headers['authorization'] || '';
  const rawKey = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!rawKey) {
    res.status(401).json({ error: 'missing_api_key', message: 'Provide your key as: Authorization: Bearer <key>' });
    return null;
  }

  const keyHash = hashApiKey(rawKey);
  const { rows } = await pool.query(
    `SELECT id, status FROM api_keys WHERE key_hash = $1 LIMIT 1`,
    [keyHash]
  );

  if (!rows[0] || rows[0].status !== 'active') {
    res.status(401).json({ error: 'invalid_api_key' });
    return null;
  }

  return rows[0];
}

function requireAdmin(req, res) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // --- Public: GET /api/matches (requires API key) ---
    if (req.method === 'GET') {
      const key = await requireApiKey(req, res);
      if (!key) return;

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

      return res.json({ matches: rows });
    }

    // --- Admin: POST /api/matches (create) ---
    if (req.method === 'POST') {
      if (!requireAdmin(req, res)) return;

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

      return res.status(201).json(rows[0]);
    }

    // --- Admin: PUT /api/matches?id=123 (update score/status) ---
    if (req.method === 'PUT') {
      if (!requireAdmin(req, res)) return;

      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id query param required' });

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
      return res.json(rows[0]);
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}