import type { FastifyInstance, FastifyReply } from 'fastify';
import type { MemberResult, Role, WorkspaceService } from '../application/workspace-service.js';

const roles = { type: 'string', enum: ['owner', 'admin', 'operator', 'viewer'] };
const memberParams = { type: 'object', required: ['workspaceId', 'memberId'], properties: {
  workspaceId: { type: 'string' }, memberId: { type: 'string', pattern: '^[a-fA-F0-9-]{36}$' }
} };

function resultReply(result: MemberResult, reply: FastifyReply) {
  if (result === 'not_found') return reply.code(404).send({ message: 'Membro indisponível.' });
  if (result === 'last_owner') return reply.code(409).send({ message: 'O workspace precisa manter um proprietário ativo.' });
  if (result === 'already_member') return reply.code(409).send({ message: 'Esta conta já é membro do workspace.' });
  return reply.code(204).send();
}

export function registerWorkspaceRoutes(app: FastifyInstance, store: WorkspaceService) {
  app.get('/workspaces', { config: { authOnly: true } }, async (request) => ({ workspaces: await store.listForUser(request.authUser!.id) }));
  app.get('/workspaces/:workspaceId/context', { config: { workspaceContextOnly: true } }, async (request) => ({ context: request.workspaceContext }));
  app.get('/workspaces/:workspaceId/audit', { config: { permission: 'audit.view' } }, async (request) => ({ events: await store.listAudit(request.workspaceContext!) }));
  app.get('/workspaces/:workspaceId/members', { config: { permission: 'members.manage' } }, async (request) => ({ members: await store.listMembers(request.workspaceContext!) }));
  app.post<{ Body: { email: string; role: Role } }>('/workspaces/:workspaceId/members', {
    config: { permission: 'members.manage' }, schema: { body: {
      type: 'object', additionalProperties: false, required: ['email', 'role'], properties: {
        email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' }, role: roles
      }
    } }
  }, async (request, reply) => resultReply(await store.inviteMember(request.workspaceContext!, request.body.email.trim().toLowerCase(), request.body.role), reply));
  app.patch<{ Params: { workspaceId: string; memberId: string }; Body: { role: Role } }>('/workspaces/:workspaceId/members/:memberId', {
    config: { permission: 'members.manage' }, schema: { params: memberParams, body: {
      type: 'object', additionalProperties: false, required: ['role'], properties: { role: roles }
    } }
  }, async (request, reply) => resultReply(await store.changeMember(request.workspaceContext!, request.params.memberId, request.body.role), reply));
  app.delete<{ Params: { workspaceId: string; memberId: string } }>('/workspaces/:workspaceId/members/:memberId', {
    config: { permission: 'members.manage' }, schema: { params: memberParams }
  }, async (request, reply) => resultReply(await store.changeMember(request.workspaceContext!, request.params.memberId, null), reply));
}
