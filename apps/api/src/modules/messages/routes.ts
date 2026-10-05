import type { FastifyInstance } from 'fastify';
import { ProviderRegistry } from '@rcs/providers';
import type { MessageService } from './service.js';
import type { MessageInput,MessageStatus } from './contracts.js';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
const statusSchema = { type: 'string',enum: ['draft','active','archived'] };
const version = { type: 'integer',minimum: 1,maximum: 2147483647 };
const suggestion = { oneOf: [
  { type: 'object',additionalProperties: false,required: ['type','text','payload'],properties: { type: { const: 'reply' },text: { type: 'string',minLength: 1,maxLength: 100 },payload: { type: 'string',minLength: 1,maxLength: 256 } } },
  { type: 'object',additionalProperties: false,required: ['type','text','url'],properties: { type: { const: 'open_url' },text: { type: 'string',minLength: 1,maxLength: 100 },url: { type: 'string',minLength: 1,maxLength: 2048 } } }
] };
const suggestions = { type: 'array',maxItems: 10,items: suggestion };
const media = { type:'object',additionalProperties:false,required:['assetId','mimeType'],properties:{assetId:uuid,mimeType:{type:'string',enum:['image/png','image/jpeg','image/webp']}} };
const card = {type:'object',additionalProperties:false,required:['title','body'],properties:{title:{type:'string',minLength:1,maxLength:200},body:{type:'string',minLength:1,maxLength:10000},suggestions,media}};
const content = { oneOf: [
  {type:'object',additionalProperties:false,required:['type','cards'],properties:{type:{const:'carousel'},cards:{type:'array',minItems:2,maxItems:10,items:card},suggestions}},
  {type:'object',additionalProperties:false,required:['type','media'],properties:{type:{const:'media'},media,suggestions}},
  {type:'object',additionalProperties:false,required:['type','media'],properties:{type:{const:'file'},media,suggestions}},
  { type: 'object',additionalProperties: false,required: ['type','text'],properties: { type: { const: 'text' },text: { type: 'string',minLength: 1,maxLength: 10000 },suggestions } },
  { type: 'object',additionalProperties: false,required: ['type','card'],properties: { type: { const: 'rich_card' },suggestions,card: {
    type: 'object',additionalProperties: false,required: ['title','body'],properties: {
      title: { type: 'string',minLength: 1,maxLength: 200 },body: { type: 'string',minLength: 1,maxLength: 10000 },suggestions,
      media: { type: 'object',additionalProperties: false,required: ['assetId','mimeType'],properties: { assetId: uuid,mimeType: { type: 'string',enum: ['image/png','image/jpeg','image/webp'] } } }
    }
  } } }
] };
const inputProperties = { name: { type: 'string',minLength: 1,maxLength: 100 },purpose: { type: 'string',enum: ['marketing','transactional','authentication'] },archetype:{type:['string','null'],maxLength:32},content };
const params = { type: 'object',additionalProperties: false,required: ['workspaceId','messageId'],properties: { workspaceId: uuid,messageId: uuid } };
export function registerMessageRoutes(app: FastifyInstance,service: MessageService,registry = new ProviderRegistry()) {
  const base = '/workspaces/:workspaceId/messages';
  app.get(`${base}/provider-options`,{ config: { permission: 'messages.view' } },async () => ({ providers: registry.list().map(({ metadata,capabilities,limits,active }) => ({ id: metadata.id,name: metadata.name,capabilities,limits,active })) }));
  app.get<{ Querystring: { offset?: string; status?: MessageStatus } }>(base,{ config: { permission: 'messages.view' },schema: {
    querystring: { type: 'object',additionalProperties: false,properties: { offset: { type: 'string',pattern: '^(0|[1-9][0-9]{0,6})$' },status: statusSchema } }
  } },async (request) => service.list(request.workspaceContext!,Number(request.query.offset ?? 0),request.query.status));
  app.post<{ Body: MessageInput }>(base,{ config: { permission: 'messages.manage' },bodyLimit: 65536,schema: {
    body: { type: 'object',additionalProperties: false,required: ['name','purpose','content'],properties: inputProperties }
  } },async (request,reply) => reply.code(201).send(await service.create(request.workspaceContext!,request.body)));
  app.get<{ Params: { workspaceId: string; messageId: string } }>(`${base}/:messageId`,{ config: { permission: 'messages.view' },schema: { params } },
    async (request) => service.get(request.workspaceContext!,request.params.messageId));
  app.put<{ Params: { workspaceId: string; messageId: string }; Body: MessageInput & { expectedVersion: number } }>(`${base}/:messageId`,{
    config: { permission: 'messages.manage' },bodyLimit: 65536,schema: { params,body: { type: 'object',additionalProperties: false,
      required: ['name','purpose','content','expectedVersion'],properties: { ...inputProperties,expectedVersion: version }
    } }
  },async (request) => service.revise(request.workspaceContext!,request.params.messageId,request.body.expectedVersion,
    { name: request.body.name,purpose: request.body.purpose,content: request.body.content,...(request.body.archetype===undefined?{}:{archetype:request.body.archetype}) }));
  app.patch<{ Params: { workspaceId: string; messageId: string }; Body: { expectedVersion: number; status: MessageStatus } }>(`${base}/:messageId/status`,{
    config: { permission: 'messages.manage' },schema: { params,body: { type: 'object',additionalProperties: false,required: ['expectedVersion','status'],properties: { expectedVersion: version,status: statusSchema } } }
  },async (request) => service.changeStatus(request.workspaceContext!,request.params.messageId,request.body.expectedVersion,request.body.status));
  app.get<{ Params: { workspaceId: string; messageId: string; version: string } }>(`${base}/:messageId/versions/:version`,{
    config: { permission: 'messages.view' },schema: { params: { ...params,required: ['workspaceId','messageId','version'],properties: {
      ...params.properties,version: { type: 'string',pattern: '^[1-9][0-9]{0,8}$' }
    } } }
  },async (request) => ({ version: await service.version(request.workspaceContext!,request.params.messageId,Number(request.params.version)) }));
}
