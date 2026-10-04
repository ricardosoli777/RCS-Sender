import type { FastifyInstance } from 'fastify';
import type { CampaignDispatchPreparation } from './dispatch-preparation.js';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
const params = { type: 'object',additionalProperties: false,required: ['workspaceId','campaignId'],properties: { workspaceId: uuid,campaignId: uuid } };
const revision = { type: 'integer',minimum: 1,maximum: 2147483647 };
type Params = { campaignId: string };
type PrepareBody = { expectedRevision: number; mode: 'dispatch' };
type RunBody = PrepareBody & { runId: string };
export function registerCampaignDispatchPreparationRoutes(app: FastifyInstance,preparation: CampaignDispatchPreparation) {
  const base = '/workspaces/:workspaceId/campaigns/:campaignId/dispatch-preparation';
  const properties = { expectedRevision: revision,mode: { const: 'dispatch' } };
  const body = { type: 'object',additionalProperties: false,required: ['expectedRevision','mode'],properties };
  const runBody = { ...body,required: [...body.required,'runId'],properties: { ...properties,runId: uuid } };
  app.get<{ Params: Params }>(base,{ config: { permission: 'campaigns.view' },schema: { params } },async (request) => ({ preparation: await preparation.get(request.workspaceContext!,request.params.campaignId) }));
  app.post<{ Params: Params; Body: PrepareBody }>(`${base}/prepare`,{ config: { permission: 'campaigns.send' },bodyLimit: 1024,schema: { params,body } },async (request,reply) => reply.code(201).send({ preparation: await preparation.prepare(request.workspaceContext!,request.params.campaignId,request.body.expectedRevision) }));
  app.post<{ Params: Params; Body: RunBody }>(`${base}/confirm`,{ config: { permission: 'campaigns.send' },bodyLimit: 1024,schema: { params,body: runBody } },async (request) => ({ preparation: await preparation.confirm(request.workspaceContext!,request.params.campaignId,request.body.expectedRevision,request.body.runId,request.body.mode) }));
  app.post<{ Params: Params; Body: RunBody }>(`${base}/cancel`,{ config: { permission: 'campaigns.send' },bodyLimit: 1024,schema: { params,body: runBody } },async (request) => ({ preparation: await preparation.cancel(request.workspaceContext!,request.params.campaignId,request.body.expectedRevision,request.body.runId) }));
}
