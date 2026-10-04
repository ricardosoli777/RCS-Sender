import type { FastifyInstance } from 'fastify';
import type { EventBus } from '@rcs/dispatch';
/** Dedicated raw parser. Signature verification is the sole authentication for this route. */
export function registerEventRoutes(app: FastifyInstance,bus: EventBus) {
  app.register(async (webhooks) => {
    webhooks.removeContentTypeParser('application/json');
    webhooks.addContentTypeParser('application/json',{ parseAs: 'buffer',bodyLimit: 65536 },(_request,body,done) => done(null,body));
    webhooks.addContentTypeParser('application/x-www-form-urlencoded',{ parseAs: 'buffer',bodyLimit: 65536 },(_request,body,done) => done(null,body));
    webhooks.post<{ Params: { provider: string }; Querystring: { connectionId: string }; Body: Buffer }>('/webhooks/rcs/:provider',{ config: { providerWebhook: true },bodyLimit: 65536,schema: { params: { type: 'object',required: ['provider'],additionalProperties: false,properties: { provider: { type: 'string',pattern: '^[a-z][a-z0-9_]{1,63}$' } } },querystring: { type: 'object',required: ['connectionId'],additionalProperties: false,properties: { connectionId: { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' } } } } },async (request,reply) => {
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ message: 'Webhook inválido.' });
      const headers = Object.fromEntries(Object.entries(request.headers).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
      if (request.params.provider === 'google_rbm' && headers['x-goog-webhook-type'] === 'verification') {
        return reply.code(200).type('text/plain; charset=utf-8').header('cache-control','no-store').send(await bus.challenge(request.params.provider,request.query.connectionId,{ rawBody: request.body,headers }));
      }
      const result = await bus.ingest(request.params.provider,request.query.connectionId,{ rawBody: request.body,headers });
      return reply.code(request.params.provider === 'google_rbm' ? 200 : 202).send(result);
    });
  });
}
