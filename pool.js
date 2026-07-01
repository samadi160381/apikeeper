import pg from 'pg';
import 'dotenv/config';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // Idle client errors shouldn't crash the process, but they should be loud.
  console.error('[pg pool] unexpected error on idle client', err);
});
