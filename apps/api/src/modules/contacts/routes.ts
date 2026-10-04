import type { FastifyInstance } from 'fastify';
import { ContactService, normalizeContact, parseContactText } from './service.js';
import type { ContactInput } from './contracts.js';
const uuid = { type: 'string', pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
const contact = { type: 'object', additionalProperties: false, required: ['phone'], properties: {
  phone: { type: 'string', minLength: 1, maxLength: 64 }, name: { type: 'string', maxLength: 100 }
} };
export function registerContactRoutes(app: FastifyInstance, service: ContactService) {
  const base = '/workspaces/:workspaceId';
  app.get<{ Querystring: { offset?: string } }>(`${base}/contacts`, { config: { permission: 'contacts.view' }, schema: {
    querystring: { type: 'object', additionalProperties: false, properties: { offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' } } }
  } }, async (request) => service.snapshot(request.workspaceContext!, Number(request.query.offset ?? 0)));
  app.post<{ Body: ContactInput }>(`${base}/contacts`, { config: { permission: 'contacts.manage' }, schema: { body: contact } },
    async (request, reply) => reply.code(201).send(await service.import(request.workspaceContext!, [normalizeContact(request.body)])));
  app.post<{ Body: { contacts?: ContactInput[]; text?: string; listId?: string } }>(`${base}/contacts/import`, {
    config: { permission: 'contacts.manage' }, bodyLimit: 131072, schema: { body: { type: 'object', additionalProperties: false,
      oneOf: [{ required: ['contacts'], not: { required: ['text'] } }, { required: ['text'], not: { required: ['contacts'] } }],
      properties: { contacts: { type: 'array', minItems: 1, maxItems: 500, items: contact }, text: { type: 'string', minLength: 1, maxLength: 65536 }, listId: uuid }
    } }
  }, async (request, reply) => {
    const result = await service.import(request.workspaceContext!, request.body.contacts ?? parseContactText(request.body.text!), request.body.listId);
    return result ?? reply.code(404).send({ message: 'Lista indisponível.' });
  });
  app.post<{ Body: { name: string } }>(`${base}/contact-lists`, { config: { permission: 'contacts.manage' }, schema: {
    body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 } } }
  } }, async (request, reply) => reply.code(201).send({ list: await service.createList(request.workspaceContext!, request.body.name) }));
  app.delete<{ Params: { workspaceId: string; listId: string } }>(`${base}/contact-lists/:listId`, { config: { permission: 'contacts.manage' }, schema: {
    params: { type: 'object', required: ['workspaceId', 'listId'], properties: { workspaceId: uuid, listId: uuid } }
  } }, async (request, reply) => await service.deleteList(request.workspaceContext!, request.params.listId) ? reply.code(204).send() : reply.code(404).send({ message: 'Lista indisponível.' }));
  app.post<{ Params: { workspaceId: string; contactId: string } }>(`${base}/contacts/:contactId/opt-out`, { config: { permission: 'contacts.manage' }, schema: {
    params: { type: 'object', required: ['workspaceId', 'contactId'], properties: { workspaceId: uuid, contactId: uuid } },
    body: { type: 'object', maxProperties: 0, additionalProperties: false }
  } }, async (request, reply) => await service.setOptOut(request.workspaceContext!, request.params.contactId) ? reply.code(204).send() : reply.code(404).send({ message: 'Contato indisponível.' }));
}
