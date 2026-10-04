import type { FastifyInstance } from 'fastify';
import type { WebhookActions } from '@rcs/dispatch';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
type Body = { id?: string; name: string; expectedRevision: number; config: unknown; status: 'active' | 'disabled' };
export function registerWebhookActionRoutes(app: FastifyInstance,service: WebhookActions) {
  const base='/workspaces/:workspaceId/webhook-endpoints';
  app.get(base,{ config: { permission: 'journeys.view' } },async (request) => service.list(request.workspaceContext!));
  app.post<{ Body: Body }>(base,{ config: { permission: 'providers.manage' },bodyLimit: 8192,schema: { body: { type: 'object',additionalProperties: false,required: ['name','expectedRevision','config','status'],properties: { id: uuid,name: { type: 'string',minLength: 1,maxLength: 100 },expectedRevision: { type: 'integer',minimum: 0,maximum: 2147483646 },status: { type: 'string',enum: ['active','disabled'] },config: { type: 'object',additionalProperties: false,required: ['url','authorization'],properties: { url: { type: 'string',maxLength: 2048 },authorization: { type: 'string',maxLength: 4096 } } } } } } },async (request,reply) => reply.code(201).send(await service.save(request.workspaceContext!,request.body)));
}
