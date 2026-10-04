import type { FastifyInstance } from 'fastify';
import { ProviderService } from '../application/provider-service.js';
const credentials = { type: 'object', minProperties: 1, maxProperties: 32, propertyNames: { pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' }, additionalProperties: { type: 'string', minLength: 1, maxLength: 16384 } };
export function registerProviderRoutes(app: FastifyInstance, service: ProviderService) {
  app.get('/workspaces/:workspaceId/providers/catalog', { config: { permission: 'providers.manage' } }, async () => ({ providers: service.catalog() }));
  app.get('/workspaces/:workspaceId/providers', { config: { permission: 'providers.manage' } }, async (request) => ({ connections: await service.list(request.workspaceContext!) }));
  app.post<{ Params: { workspaceId: string; connectionId: string } }>('/workspaces/:workspaceId/providers/:connectionId/test', {
    config: { permission: 'providers.manage' }, bodyLimit: 1024, schema: { params: { type: 'object', additionalProperties: false,
      required: ['workspaceId', 'connectionId'], properties: { workspaceId: { type: 'string' },
        connectionId: { type: 'string', pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' } } },
      body: { type: 'object', additionalProperties: false, maxProperties: 0 } }
  }, async (request, reply) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => { if (!reply.raw.writableEnded) controller.abort(); };
    request.raw.once('aborted', abort); reply.raw.once('close', close);
    try {
      return await service.testConnection(request.workspaceContext!, request.params.connectionId, controller.signal);
    } finally { request.raw.removeListener('aborted', abort); reply.raw.removeListener('close', close); }
  });
  app.post<{ Body: { providerId: string; name: string; environment: string; credentials: Record<string, string> } }>('/workspaces/:workspaceId/providers', {
    config: { permission: 'providers.manage' }, bodyLimit: 65536, schema: { body: { type: 'object', additionalProperties: false, required: ['providerId', 'name', 'environment', 'credentials'], properties: {
      providerId: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' }, name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
      environment: { type: 'string', minLength: 1, maxLength: 64 }, credentials
    } } }
  }, async (request, reply) => reply.code(201).send({ connection: await service.create(request.workspaceContext!, { ...request.body, name: request.body.name.trim() }) }));
  app.put<{ Params: { workspaceId: string; connectionId: string }; Body: { credentials: Record<string, string> } }>('/workspaces/:workspaceId/providers/:connectionId/credentials', {
    config: { permission: 'providers.manage' }, bodyLimit: 65536, schema: { params: { type: 'object', required: ['workspaceId', 'connectionId'], properties: {
      workspaceId: { type: 'string' }, connectionId: { type: 'string', pattern: '^[a-fA-F0-9-]{36}$' }
    } }, body: { type: 'object', additionalProperties: false, required: ['credentials'], properties: { credentials } } }
  }, async (request, reply) => { await service.updateCredentials(request.workspaceContext!, request.params.connectionId, request.body.credentials); return reply.code(204).send(); });
}
