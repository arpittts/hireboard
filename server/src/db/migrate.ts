import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { pool } from './pool.js';

// server/migrations, from both src/db (tsx) and dist/db (compiled).
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

// Any fixed number works; it only has to be the same for every run.
const LOCK_ID = 727_001;

// Apply every .sql file in migrations/ that hasn't run yet, in name order.
// Each file runs in its own transaction, so a failing file changes nothing.
export async function runMigrations(db: pg.Pool = pool): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    // Two server instances starting together must not migrate at the same time.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name varchar(200) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const doneNames = new Set(done.rows.map((row) => row.name));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (doneNames.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Run directly (`npm run migrate`, or `node dist/db/migrate.js` on Render).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length ? `✅ Applied: ${applied.join(', ')}` : '✅ Database is up to date');
      return pool.end();
    })
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
