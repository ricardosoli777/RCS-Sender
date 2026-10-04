import { readFile, readdir } from 'node:fs/promises';
import type { Pool } from 'pg';
export { Pool as DatabasePool } from 'pg';
export { SimulationOutbox,processSimulationBatch,type SimulationJob } from './campaign-simulation.js';
export {retryDelay} from './retry-delay.js';

const MIGRATIONS_URL = new URL('../migrations/', import.meta.url);

export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const appliedNow: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [761829]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(result.rows.map((row) => row.name));
    const files = (await readdir(MIGRATIONS_URL)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(new URL(name, MIGRATIONS_URL), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      appliedNow.push(name);
    }
    await client.query('COMMIT');
    return appliedNow;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
