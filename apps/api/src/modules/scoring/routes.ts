import type { FastifyInstance } from 'fastify';
import type { ScoringService } from '@rcs/dispatch';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
export function registerScoringRoutes(app: FastifyInstance,service: ScoringService) {
  const base = '/workspaces/:workspaceId/scoring';
  app.get(base,{ config: { permission: 'analytics.view' } },async (request) => service.settings(request.workspaceContext!));
  app.put<{ Body: { expectedRevision: number; rules: unknown } }>(base,{ config: { permission: 'contacts.manage' },bodyLimit: 8192,schema: { body: { type: 'object',additionalProperties: false,required: ['expectedRevision','rules'],properties: { expectedRevision: { type: 'integer',minimum: 0,maximum: 2147483646 },rules: { type: 'array',maxItems: 20,items: { type: 'object' } } } } } },async (request) => service.saveSettings(request.workspaceContext!,request.body.expectedRevision,request.body.rules));
  app.get<{ Params: { contactId: string }; Querystring: { offset?: string } }>('/workspaces/:workspaceId/contacts/:contactId/score',{ config: { permission: 'contacts.view' },schema: { params: { type: 'object',additionalProperties: false,required: ['workspaceId','contactId'],properties: { workspaceId: uuid,contactId: uuid } },querystring: { type: 'object',additionalProperties: false,properties: { offset: { type: 'string',pattern: '^(0|[1-9][0-9]{0,6})$' } } } } },async (request) => service.contact(request.workspaceContext!,request.params.contactId,Number(request.query.offset ?? 0)));
}
