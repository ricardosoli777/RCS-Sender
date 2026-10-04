import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { loadServerConfig } from '@rcs/config';
import { createApp } from './app.js';
import { CredentialCipher } from '@rcs/security';

const config = loadServerConfig(process.env);
const db = new Pool({ connectionString: config.DATABASE_URL });
const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const credentialCipher = config.RCS_CREDENTIAL_KEYS && config.RCS_CREDENTIAL_ACTIVE_KEY
  ? new CredentialCipher(config.RCS_CREDENTIAL_ACTIVE_KEY, Object.fromEntries(Object.entries(config.RCS_CREDENTIAL_KEYS).map(([version, hex]) => [version, Buffer.from(hex, 'hex')]))) : undefined;
const app = createApp({ db, redis, credentialCipher }, { appUrl: config.APP_URL, secureCookies: config.NODE_ENV === 'production',
  proxySecret: config.RCS_API_PROXY_SECRET });

async function shutdown() {
  await app.close();
  await Promise.all([db.end(), redis.quit().catch(() => redis.disconnect())]);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  await app.listen({ host: '127.0.0.1', port: config.API_PORT });
} catch {
  app.log.error({code:'STARTUP_FAILED'},'API startup failed');
  await shutdown();
  process.exitCode = 1;
}
