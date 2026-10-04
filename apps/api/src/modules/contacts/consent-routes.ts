import type { FastifyInstance } from 'fastify';
import { consentPurposes,consentSources,type ConsentInput,type ContactConsents } from './consents.js';
const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
export function registerConsentRoutes(app: FastifyInstance,consents: ContactConsents) {
  const base = '/workspaces/:workspaceId/contacts/:contactId/rcs-consents';
  const params = { type: 'object',additionalProperties: false,required: ['workspaceId','contactId'],properties: { workspaceId: uuid,contactId: uuid } };
  app.get<{ Params: { contactId: string } }>(base,{ config: { permission: 'contacts.view' },schema: { params } },async (request) => consents.get(request.workspaceContext!,request.params.contactId));
  app.post<{ Params: { contactId: string }; Body: ConsentInput }>(base,{ config: { permission: 'contacts.manage' },bodyLimit: 2048,schema: { params,body: { type: 'object',additionalProperties: false,required: ['purpose','state','source','evidenceReference','observedAt','expectedRevision','expectedPhone'],properties: { purpose: { enum: consentPurposes },state: { enum: ['granted','revoked'] },source: { enum: consentSources },evidenceReference: { type: 'string',minLength: 1,maxLength: 128 },observedAt: { type: 'string',maxLength: 24 },expectedPhone: { type: 'string',pattern: '^\\+[1-9][0-9]{7,14}$' },expectedRevision: { type: 'integer',minimum: 0,maximum: 2147483646 } } } } },async (request,reply) => reply.code(201).send(await consents.record(request.workspaceContext!,request.params.contactId,request.body)));
}
