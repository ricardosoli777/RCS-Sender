import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger } from '@rcs/observability';

export function createApp(deps: { db: Pool; redis: Redis }) {
  const app = Fastify({ loggerInstance: createLogger('api'), bodyLimit: 1_048_576 });

  app.register(helmet);
  app.register(rateLimit, {
    redis: deps.redis,
    max: 100,
    timeWindow: '1 minute',
    skipOnError: false
  });

  app.get('/health/live', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await Promise.all([deps.db.query('SELECT 1'), deps.redis.ping()]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  return app;
}
