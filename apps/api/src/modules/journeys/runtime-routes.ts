import type { FastifyInstance } from 'fastify';
import type { JourneyRuntime } from '@rcs/dispatch';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
const params = { type: 'object',additionalProperties: false,required: ['workspaceId','journeyId'],properties: { workspaceId: uuid,journeyId: uuid } };
export function registerJourneyRuntimeRoutes(app: FastifyInstance,runtime: JourneyRuntime) {
  const base = '/workspaces/:workspaceId/journeys/:journeyId/enrollments';
  app.get<{ Params: { journeyId: string }; Querystring: { offset?: string } }>(base,{ config: { permission: 'journeys.view' },schema: { params,querystring: { type: 'object',additionalProperties: false,properties: { offset: { type: 'string',pattern: '^(0|[1-9][0-9]{0,6})$' } } } } },async (request) => runtime.list(request.workspaceContext!,request.params.journeyId,Number(request.query.offset ?? 0)));
  app.post<{ Params: { journeyId: string }; Body: { contactId: string; source: 'manual' } }>(base,{ config: { permission: 'journeys.manage' },bodyLimit: 1024,schema: { params,body: { type: 'object',additionalProperties: false,required: ['contactId','source'],properties: { contactId: uuid,source: { const: 'manual' } } } } },async (request,reply) => reply.code(201).send({ enrollment: await runtime.enroll(request.workspaceContext!,request.params.journeyId,request.body.contactId,'manual') }));
}
