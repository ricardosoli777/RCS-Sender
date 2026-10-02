export type Role = 'owner' | 'admin' | 'operator' | 'viewer';
export type Permission = 'workspace.manage' | 'members.manage' | 'providers.manage' | 'contacts.manage'
  | 'messages.manage' | 'campaigns.manage' | 'campaigns.send' | 'analytics.view' | 'audit.view'
  | 'contacts.view' | 'messages.view' | 'campaigns.view';

export const permissions: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ['workspace.manage', 'members.manage', 'providers.manage', 'contacts.manage', 'messages.manage',
    'campaigns.manage', 'campaigns.send', 'analytics.view', 'audit.view'],
  admin: ['providers.manage', 'contacts.manage', 'messages.manage', 'campaigns.manage', 'campaigns.send', 'analytics.view'],
  operator: ['contacts.manage', 'messages.manage', 'campaigns.manage', 'campaigns.send', 'analytics.view'],
  viewer: ['contacts.view', 'messages.view', 'campaigns.view', 'analytics.view']
};

export type Workspace = { id: string; name: string; slug: string; status: string; role: Role };
export type WorkspaceContext = Readonly<{
  user_id: string; workspace_id: string; role: Role; permissions: readonly Permission[]
}>;
export type Member = { id: string; user_id: string; name: string; email: string; role: Role; status: string };
export type AuditEvent = { id: string; workspace_id: string; actor_user_id: string | null;
  event: string; entity_type: string | null; entity_id: string | null; timestamp: Date; metadata: Record<string, unknown> };
export type MemberResult = 'ok' | 'not_found' | 'last_owner' | 'already_member';

export interface WorkspaceStore {
  listForUser(userId: string): Promise<Workspace[]>;
  resolveContext(userId: string, workspaceId: string): Promise<WorkspaceContext | null>;
  listAudit(workspaceId: string): Promise<AuditEvent[]>;
  listMembers(workspaceId: string): Promise<Member[]>;
  inviteMember(context: WorkspaceContext, email: string, role: Role): Promise<MemberResult>;
  changeMember(context: WorkspaceContext, memberId: string, role: Role | null): Promise<MemberResult>;
}
