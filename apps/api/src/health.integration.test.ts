import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { createApp } from './app.js';

const run = process.env.RUN_SERVICE_TESTS === '1';

describe('health com serviços reais', () => {
  it.skipIf(!run)('confirma PostgreSQL e Redis antes de declarar prontidão', async () => {
    const db = new Pool({ connectionString: process.env.DATABASE_URL });
    const redis = new Redis(process.env.REDIS_URL!);
    const app = createApp({ db, redis });
    try {
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ready' });
    } finally {
      await app.close();
      await db.end();
      redis.disconnect();
    }
  });
});
