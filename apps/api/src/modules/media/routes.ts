import type { FastifyInstance } from 'fastify';
import type { MediaService } from './service.js';
import { maxImageBytes,maxUploadBodyBytes,type ImageMime } from './contracts.js';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
export function registerMediaRoutes(app: FastifyInstance, service: MediaService) {
  const base = '/workspaces/:workspaceId/media';
  app.get<{ Querystring: { offset?: string } }>(base,{ config: { permission: 'messages.view' },schema: {
    querystring: { type: 'object',additionalProperties: false,properties: { offset: { type: 'string',pattern: '^(0|[1-9][0-9]{0,6})$' } } }
  } },async (request) => service.list(request.workspaceContext!,Number(request.query.offset ?? 0)));
  app.post<{ Body: { name: string; mimeType: ImageMime; dataBase64: string } }>(base,{ config: { permission: 'messages.manage' },bodyLimit: maxUploadBodyBytes,schema: {
    body: { type: 'object',additionalProperties: false,required: ['name','mimeType','dataBase64'],properties: {
      name: { type: 'string',minLength: 1,maxLength: 100 },mimeType: { type: 'string',enum: ['image/png','image/jpeg','image/webp'] },
      dataBase64: { type: 'string',minLength: 4,maxLength: Math.ceil(maxImageBytes/3)*4 }
    } }
  } },async (request,reply) => {
    const controller = new AbortController(); const abort = () => controller.abort(); const close = () => { if (!reply.raw.writableEnded) controller.abort(); };
    request.raw.once('aborted',abort); reply.raw.once('close',close);
    try { return reply.code(201).send({ asset: await service.upload(request.workspaceContext!,request.body,controller.signal) }); }
    finally { request.raw.removeListener('aborted',abort); reply.raw.removeListener('close',close); }
  });
  app.get<{ Params: { workspaceId: string; assetId: string } }>(`${base}/:assetId/content`,{ config: { permission: 'messages.view' },schema: {
    params: { type: 'object',additionalProperties: false,required: ['workspaceId','assetId'],properties: { workspaceId: uuid,assetId: uuid } }
  } },async (request,reply) => {
    const result = await service.get(request.workspaceContext!,request.params.assetId);
    if (!result) return reply.code(404).send({ message: 'Mídia indisponível.' });
    const extension = result.asset.mime_type === 'image/jpeg' ? 'jpg' : result.asset.mime_type === 'image/png' ? 'png' : 'webp';
    return reply.type(result.asset.mime_type).header('Content-Disposition',`inline; filename="${result.asset.id}.${extension}"`)
      .header('X-Content-Type-Options','nosniff').send(result.content);
  });
}
