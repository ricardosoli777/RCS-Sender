import type { FastifyInstance } from 'fastify';
import type { EligibilityService } from './service.js';
const uuid = { type: 'string', pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
export function registerEligibilityRoutes(app: FastifyInstance, service: EligibilityService) {
  app.post<{ Params: { workspaceId: string; connectionId: string }; Body: { contactId: string } }>('/workspaces/:workspaceId/providers/:connectionId/eligibility', {
    config: { permission: 'providers.manage' }, bodyLimit: 1024, schema: {
      params: { type: 'object', additionalProperties: false, required: ['workspaceId','connectionId'], properties: { workspaceId: uuid, connectionId: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['contactId'], properties: { contactId: uuid } }
    }
  }, async (request, reply) => {
    const controller = new AbortController(); const abort = () => controller.abort();
    const close = () => { if (!reply.raw.writableEnded) controller.abort(); };
    request.raw.once('aborted',abort); reply.raw.once('close',close);
    try { return await service.check(request.workspaceContext!, request.params.connectionId, request.body.contactId, controller.signal); }
    finally { request.raw.removeListener('aborted',abort); reply.raw.removeListener('close',close); }
  });
}
