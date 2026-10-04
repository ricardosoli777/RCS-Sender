import type { FastifyInstance } from 'fastify';
import type { DispatchRuntime } from '@rcs/dispatch';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
const params = { type: 'object',additionalProperties: false,required: ['workspaceId','campaignId'],properties: { workspaceId: uuid,campaignId: uuid } };
type Params = { campaignId: string };
export function registerCampaignDispatchRoutes(app: FastifyInstance,runtime: DispatchRuntime) {
  const base = '/workspaces/:workspaceId/campaigns/:campaignId/dispatch';
  app.get<{ Params: Params }>(base,{ config: { permission: 'campaigns.view' },schema: { params } },async (request) => ({ dispatch: await runtime.summary(request.workspaceContext!,request.params.campaignId) }));
  app.post<{Params:Params;Body:{expectedRevision:number;action:'pause'|'resume'|'stop'}}>(`${base}/control`,{config:{permission:'campaigns.send'},bodyLimit:1024,schema:{params,body:{type:'object',additionalProperties:false,required:['expectedRevision','action'],properties:{expectedRevision:{type:'integer',minimum:1,maximum:2147483646},action:{type:'string',enum:['pause','resume','stop']}}}}},async(request)=>({dispatch:await runtime.control(request.workspaceContext!,request.params.campaignId,request.body.expectedRevision,request.body.action)}));
  app.post<{ Params: Params; Body: { mode: 'dispatch'; expectedRevision: number; runId: string } }>(`${base}/enqueue`,{ config: { permission: 'campaigns.send' },bodyLimit: 1024,schema: { params,body: { type: 'object',additionalProperties: false,required: ['mode','expectedRevision','runId'],properties: { mode: { const: 'dispatch' },expectedRevision: { type: 'integer',minimum: 1,maximum: 2147483646 },runId: uuid } } } },async (request,reply) => reply.code(201).send({ dispatch: await runtime.enqueue(request.workspaceContext!,request.params.campaignId,request.body.expectedRevision,request.body.runId) }));
}
