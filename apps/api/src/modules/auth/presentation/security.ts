import type { FastifyInstance } from 'fastify';
import type { AuthStore, AuthUser } from '../domain/contracts.js';
import { hashToken } from '../application/auth-service.js';
import type { Permission, WorkspaceContext, WorkspaceStore } from '../../workspaces/domain/contracts.js';

declare module 'fastify' {
  interface FastifyRequest { authUser: AuthUser | null; sessionHash: Buffer | null; workspaceContext: WorkspaceContext | null }
  interface FastifyContextConfig { authOnly?: boolean; workspaceContextOnly?: boolean; permission?: Permission; providerWebhook?: boolean; providerMedia?: boolean }
}

export type AuthOptions = { appUrl: string; secureCookies: boolean };
export function sessionCookieName(options: AuthOptions): string {
  return options.secureCookies ? '__Host-rcs_session' : 'rcs_session';
}
export function sessionCookie(token: string, seconds: number, options: AuthOptions): string {
  return `${sessionCookieName(options)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${options.secureCookies ? '; Secure' : ''}`;
}
export function sessionToken(cookie: string | undefined, name: string): string | null {
  const matches = (cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function registerSecurity(app: FastifyInstance, auth: AuthStore, workspaces: WorkspaceStore, options: AuthOptions) {
  const origin = new URL(options.appUrl).origin;
  app.decorateRequest('authUser', null);
  app.decorateRequest('sessionHash', null);
  app.decorateRequest('workspaceContext', null);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const route = request.routeOptions.url;
    if (request.method === 'GET' && (route === '/health/live' || route === '/health/ready')) return;
    if (['GET','HEAD'].includes(request.method) && route === '/provider-media/:token' && request.routeOptions.config.providerMedia === true) return;
    if (request.method === 'POST' && route === '/webhooks/rcs/:provider' && request.routeOptions.config.providerWebhook === true) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.origin !== origin || request.headers['x-rcs-request'] !== '1') {
        return reply.code(403).send({ message: 'Origem da requisição não autorizada.' });
      }
    }
    if (request.method === 'POST' && (route === '/auth/login' || route === '/auth/register')) return;
    const token = sessionToken(request.headers.cookie, sessionCookieName(options));
    if (!token) return reply.code(401).send({ message: 'Autenticação necessária.' });
    request.sessionHash = hashToken(token);
    request.authUser = await auth.findSession(request.sessionHash);
    if (!request.authUser) return reply.code(401).send({ message: 'Sessão inválida ou expirada.' });
    const config = request.routeOptions.config;
    if (config.authOnly === true) return;
    if (!config.permission && !config.workspaceContextOnly) {
      return reply.code(403).send({ message: 'Permissão insuficiente.' });
    }
    const workspaceId = (request.params as { workspaceId?: string }).workspaceId;
    if (!workspaceId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(workspaceId)) {
      return reply.code(404).send({ message: 'Workspace indisponível.' });
    }
    request.workspaceContext = await workspaces.resolveContext(request.authUser.id, workspaceId);
    if (!request.workspaceContext) return reply.code(404).send({ message: 'Workspace indisponível.' });
    if (config.permission && !request.workspaceContext.permissions.includes(config.permission)) {
      return reply.code(403).send({ message: 'Permissão insuficiente.' });
    }
  });
}
