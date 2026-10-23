import pg from 'pg';
import { config, isProduction } from '../config.js';

// Keep DATE columns as 'YYYY-MM-DD' strings. By default pg turns them into a
// Date at local midnight, which shifts the day when the server isn't on UTC.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // An idle connection was closed (for example when Neon suspends). The pool
  // replaces it on the next query, so log and carry on.
  console.error('❌ PostgreSQL connection error:', err.message);
});

// Run fn inside BEGIN/COMMIT on one connection; any error rolls everything back.
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
