import Fastify, { type FastifyBaseLogger, type FastifyError } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger } from '@rcs/observability';
import { registerSecurity } from './modules/auth/presentation/security.js';
import { registerAuthRoutes } from './modules/auth/presentation/routes.js';
import type { AuthStore } from './modules/auth/domain/contracts.js';
import { PgAuthStore } from './modules/auth/infrastructure/pg-auth-store.js';
import type { WorkspaceStore } from './modules/workspaces/domain/contracts.js';
import { PgWorkspaceStore } from './modules/workspaces/infrastructure/pg-workspace-store.js';
import { registerWorkspaceRoutes } from './modules/workspaces/presentation/routes.js';
import { WorkspaceAccessError, WorkspaceService } from './modules/workspaces/application/workspace-service.js';

export function createApp(deps: { db: Pool; redis: Redis; authStore?: AuthStore; workspaceStore?: WorkspaceStore },
  auth: { appUrl: string; secureCookies: boolean; proxySecret?: string }) {
  if (auth.proxySecret && !/^[a-f0-9]{64}$/.test(auth.proxySecret)) throw new Error('Segredo de proxy inválido');
  const app = Fastify({ loggerInstance: createLogger('api') as FastifyBaseLogger, bodyLimit: 1_048_576,
    trustProxy: auth.proxySecret ? (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });

  app.addHook('onRequest', async (request, reply) => {
    if (!auth.proxySecret || request.headers['x-forwarded-for'] === undefined) return;
    const token = request.headers['x-rcs-proxy-token'];
    const ip = request.headers['x-forwarded-for'];
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
      || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || !timingSafeEqual(Buffer.from(token), Buffer.from(auth.proxySecret))
      || typeof ip !== 'string' || !isIP(ip) || ip.includes('%')) {
      return reply.code(403).header('Cache-Control', 'no-store').send({ message: 'Proxy não autorizado.' });
    }
  });

  app.register(helmet);
  app.register(rateLimit, {
    redis: deps.redis,
    max: 100,
    timeWindow: '1 minute',
    skipOnError: false
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof WorkspaceAccessError) return reply.code(error.reason === 'not_found' ? 404 : 403)
      .send({ message: error.reason === 'not_found' ? 'Workspace indisponível.' : 'Permissão insuficiente.' });
    if (error.validation) return reply.code(400).send({ message: 'Dados inválidos.' });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ message: error.statusCode === 429
        ? 'Muitas tentativas. Tente novamente em um minuto.' : 'Requisição inválida.' });
    }
    request.log.error({ code: error.code ?? 'SERVICE_ERROR' }, 'Falha no processamento da requisição');
    return reply.code(503).send({ message: 'Serviço temporariamente indisponível.' });
  });
  const authStore = deps.authStore ?? new PgAuthStore(deps.db);
  const workspaceStore = deps.workspaceStore ?? new PgWorkspaceStore(deps.db);
  registerSecurity(app, authStore, workspaceStore, auth);
  // Register routes after plugins so their rate-limit onRoute hooks are installed.
  app.after(() => {
    registerAuthRoutes(app, authStore, auth);
    registerWorkspaceRoutes(app, new WorkspaceService(workspaceStore));
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
