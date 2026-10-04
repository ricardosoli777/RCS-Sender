import type { FastifyInstance } from 'fastify';
import type { AnalyticsService } from '@rcs/dispatch';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
export function registerAnalyticsRoutes(app: FastifyInstance,service: AnalyticsService) {
  app.get('/workspaces/:workspaceId/analytics',{ config: { permission: 'analytics.view' } },async (request) => service.workspace(request.workspaceContext!));
  app.get<{ Params: { journeyId: string }; Querystring: { version?: string } }>('/workspaces/:workspaceId/journeys/:journeyId/analytics',{ config: { permission: 'analytics.view' },schema: { params: { type: 'object',additionalProperties: false,required: ['workspaceId','journeyId'],properties: { workspaceId: uuid,journeyId: uuid } },querystring: { type: 'object',additionalProperties: false,properties: { version: { type: 'string',pattern: '^[1-9][0-9]{0,6}$' } } } } },async (request) => service.journey(request.workspaceContext!,request.params.journeyId,request.query.version ? Number(request.query.version) : undefined));
}
