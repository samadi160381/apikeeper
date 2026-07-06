import crypto from 'crypto';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function requireAdmin(req, res) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function generateApiKey() {
  return 'sk_' + crypto.randomBytes(24).toString('hex');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    try {
      const result = await pool.query(
        `SELECT id, key_prefix, description, status, created_at 
         FROM api_keys 
         ORDER BY created_at DESC`
      );
      return res.status(200).json({
        keys: result.rows.map(row => ({
          id: row.id,
          key: row.key_prefix || 'sk_****',
          description: row.description,
          status: row.status || 'active',
          created_at: row.created_at
        }))
      });
    } catch (error) {
      console.error('Error fetching keys:', error);
      return res.status(500).json({ error: 'Failed to fetch keys' });
    }
  }

  if (req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const { name, description } = req.body;
      const newKey = generateApiKey();
      const keyHash = hashKey(newKey);
      const keyPrefix = newKey.substring(0, 16) + '...';

      await pool.query(
        `INSERT INTO api_keys (key_hash, key_prefix, description, status, created_at)
         VALUES ($1, $2, $3, 'active', NOW())`,
        [keyHash, keyPrefix, description || null]
      );

      return res.status(201).json({
        key: newKey,
        message: 'Key created successfully. Save it now.',
        prefix: keyPrefix
      });
    } catch (error) {
      console.error('Error creating key:', error);
      return res.status(500).json({ error: 'Failed to create key' });
    }
  }

  if (req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    try {
      const keyId = req.url.split('/').pop();
      if (!keyId || keyId === 'keys') {
        return res.status(400).json({ error: 'Invalid key ID' });
      }
      const result = await pool.query('DELETE FROM api_keys WHERE id = $1', [keyId]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Key not found' });
      }
      return res.status(200).json({ message: 'Key deleted successfully' });
    } catch (error) {
      console.error('Error deleting key:', error);
      return res.status(500).json({ error: 'Failed to delete key' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
