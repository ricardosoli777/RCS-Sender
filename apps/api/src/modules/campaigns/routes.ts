import type { FastifyInstance } from 'fastify';
import { campaignStatuses,type CampaignInput,type CampaignOptionKind,type CampaignStatus } from './contracts.js';
import type { CampaignService } from './service.js';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
const reference = { anyOf: [uuid,{ type: 'null' }] };
const revision = { type: 'integer',minimum: 1,maximum: 2147483647 };
const params = { type: 'object',additionalProperties: false,required: ['workspaceId','campaignId'],properties: { workspaceId: uuid,campaignId: uuid } };
const properties = { name: { type: 'string',minLength: 1,maxLength: 100 },objective: { type: 'string',minLength: 1,maxLength: 500 },providerConnectionId: reference,audienceListId: reference,messageVersionId: reference,agentId: { type: ['string','null'],minLength: 1,maxLength: 128 },scheduledAt: { type: ['string','null'],maxLength: 24 } };
export function registerCampaignRoutes(app: FastifyInstance,service: CampaignService) {
  const base = '/workspaces/:workspaceId/campaigns';
  app.get<{ Querystring: { kind: CampaignOptionKind; offset?: string } }>(`${base}/options`,{ config: { permission: 'campaigns.manage' },schema: { querystring: { type: 'object',additionalProperties: false,required: ['kind'],properties: { kind: { type: 'string',enum: ['connections','audiences','messages'] },offset: { type: 'string',pattern: '^(0|[1-9][0-9]{0,6})$' } } } } },async (request) => service.options(request.workspaceContext!,request.query.kind,Number(request.query.offset ?? 0)));
  app.get<{ Querystring: { offset?: string; status?: CampaignStatus } }>(base,{ config: { permission: 'campaigns.view' },schema: { querystring: { type: 'object',additionalProperties: false,properties: { offset: { type: 'string',pattern: '^(0|[1-9][0-9]{0,6})$' },status: { type: 'string',enum: campaignStatuses } } } } },async (request) => service.list(request.workspaceContext!,Number(request.query.offset ?? 0),request.query.status));
  app.post<{ Body: CampaignInput }>(base,{ config: { permission: 'campaigns.manage' },bodyLimit: 8192,schema: { body: { type: 'object',additionalProperties: false,required: ['name','objective'],properties } } },async (request,reply) => reply.code(201).send({ campaign: await service.create(request.workspaceContext!,request.body) }));
  app.get<{ Params: { workspaceId: string; campaignId: string } }>(`${base}/:campaignId`,{ config: { permission: 'campaigns.view' },schema: { params } },async (request) => ({ campaign: await service.get(request.workspaceContext!,request.params.campaignId) }));
  app.put<{ Params: { workspaceId: string; campaignId: string }; Body: CampaignInput & { expectedRevision: number } }>(`${base}/:campaignId`,{ config: { permission: 'campaigns.manage' },bodyLimit: 8192,schema: { params,body: { type: 'object',additionalProperties: false,required: ['name','objective','expectedRevision'],properties: { ...properties,expectedRevision: revision } } } },async (request) => {
    const { expectedRevision,...input } = request.body; return { campaign: await service.revise(request.workspaceContext!,request.params.campaignId,expectedRevision,input) };
  });
  app.post<{ Params: { workspaceId: string; campaignId: string }; Body: { expectedRevision: number } }>(`${base}/:campaignId/cancel`,{ config: { permission: 'campaigns.manage' },bodyLimit: 1024,schema: { params,body: { type: 'object',additionalProperties: false,required: ['expectedRevision'],properties: { expectedRevision: revision } } } },async (request) => ({ campaign: await service.cancel(request.workspaceContext!,request.params.campaignId,request.body.expectedRevision) }));
  app.get<{ Params: { workspaceId: string; campaignId: string } }>(`${base}/:campaignId/review`,{ config: { permission: 'campaigns.view' },schema: { params } },async (request) => service.review(request.workspaceContext!,request.params.campaignId));
}
