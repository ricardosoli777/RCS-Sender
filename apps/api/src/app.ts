import Fastify from 'fastify';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { createLogger } from '@rcs/observability';

export function createApp(deps: { db: Pool; redis: Redis }) {
  const app = Fastify({ loggerInstance: createLogger('api'), bodyLimit: 1_048_576 });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await Promise.all([deps.db.query('SELECT 1'), deps.redis.ping()]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  return app;
}

