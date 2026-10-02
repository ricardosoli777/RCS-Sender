import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from './index.js';

describe('migrations', () => {
  it.skipIf(process.env.RUN_SERVICE_TESTS !== '1')('cria o esquema e pode executar novamente', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await migrate(pool);
      expect(await migrate(pool)).toEqual([]);
      const result = await pool.query("SELECT to_regclass('public.users') AS users, to_regclass('public.sessions') AS sessions");
      expect(result.rows[0]).toMatchObject({ users: 'users', sessions: 'sessions' });
    } finally {
      await pool.end();
    }
  });
});
