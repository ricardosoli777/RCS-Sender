import type { FastifyInstance } from 'fastify';
import type { AuthStore } from '../domain/contracts.js';
import { AuthService, SESSION_SECONDS } from '../application/auth-service.js';
import { sessionCookie, type AuthOptions } from './security.js';

const emailSchema = { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' };
const nameSchema = { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' };

export function registerAuthRoutes(app: FastifyInstance, store: AuthStore, options: AuthOptions) {
  const service = new AuthService(store);
  app.post<{ Body: { email: string; password: string } }>('/auth/login', {
    bodyLimit: 8192, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['email', 'password'],
      properties: { email: emailSchema, password: { type: 'string', minLength: 1, maxLength: 1024 } } } }
  }, async (request, reply) => {
    const result = await service.login(request.body.email, request.body.password);
    if (!result) return reply.code(401).send({ message: 'E-mail ou senha inválidos.' });
    reply.header('Set-Cookie', sessionCookie(result.token, SESSION_SECONDS, options));
    return { user: result.user };
  });
  app.post<{ Body: { name: string; email: string; password: string; workspaceName: string } }>('/auth/register', {
    bodyLimit: 8192, config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'email', 'password', 'workspaceName'],
      properties: { name: nameSchema, email: emailSchema, password: { type: 'string', minLength: 12, maxLength: 1024 }, workspaceName: nameSchema } } }
  }, async (request, reply) => {
    const result = await service.register(request.body);
    if (!result) return reply.code(400).send({ message: 'Não foi possível criar a conta com os dados informados.' });
    reply.header('Set-Cookie', sessionCookie(result.token, SESSION_SECONDS, options)).code(201);
    return { user: result.user };
  });
  app.get('/auth/me', { config: { authOnly: true } }, async (request) => ({ user: request.authUser }));
  app.post('/auth/logout', { config: { authOnly: true } }, async (request, reply) => {
    await store.revokeSession(request.sessionHash!, request.authUser!.id);
    return reply.header('Set-Cookie', sessionCookie('', 0, options)).code(204).send();
  });
}
