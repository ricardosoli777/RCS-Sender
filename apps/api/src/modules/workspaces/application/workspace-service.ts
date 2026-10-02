import type { Permission, Role, WorkspaceContext, WorkspaceStore } from '../domain/contracts.js';
export type { Role, MemberResult } from '../domain/contracts.js';

export class WorkspaceAccessError extends Error {
  constructor(readonly reason: 'not_found' | 'forbidden') { super('Workspace access denied'); }
}

export class WorkspaceService {
  constructor(private readonly store: WorkspaceStore) {}

  listForUser(userId: string) { return this.store.listForUser(userId); }
  resolveContext(userId: string, workspaceId: string) { return this.store.resolveContext(userId, workspaceId); }

  private async authorize(context: WorkspaceContext, permission: Permission): Promise<WorkspaceContext> {
    const fresh = await this.store.resolveContext(context.user_id, context.workspace_id);
    if (!fresh) throw new WorkspaceAccessError('not_found');
    if (!fresh.permissions.includes(permission)) throw new WorkspaceAccessError('forbidden');
    return fresh;
  }

  async listAudit(context: WorkspaceContext) {
    const fresh = await this.authorize(context, 'audit.view');
    return this.store.listAudit(fresh.workspace_id);
  }

  async listMembers(context: WorkspaceContext) {
    const fresh = await this.authorize(context, 'members.manage');
    return this.store.listMembers(fresh.workspace_id);
  }

  async inviteMember(context: WorkspaceContext, email: string, role: Role) {
    const fresh = await this.authorize(context, 'members.manage');
    return this.store.inviteMember(fresh, email, role);
  }

  async changeMember(context: WorkspaceContext, memberId: string, role: Role | null) {
    const fresh = await this.authorize(context, 'members.manage');
    return this.store.changeMember(fresh, memberId, role);
  }
}
