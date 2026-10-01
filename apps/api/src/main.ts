import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { loadServerConfig } from '@rcs/config';
import { createApp } from './app.js';

const config = loadServerConfig(process.env);
const db = new Pool({ connectionString: config.DATABASE_URL });
const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const app = createApp({ db, redis });

async function shutdown() {
  await app.close();
  await Promise.all([db.end(), redis.quit().catch(() => redis.disconnect())]);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  await app.listen({ host: '127.0.0.1', port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
