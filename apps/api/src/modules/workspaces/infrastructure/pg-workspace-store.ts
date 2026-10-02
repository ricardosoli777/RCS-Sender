import type { Pool, PoolClient } from 'pg';
import { permissions, type AuditEvent, type Member, type MemberResult, type Role,
  type Workspace, type WorkspaceContext, type WorkspaceStore } from '../domain/contracts.js';
import { transaction } from '../../shared/infrastructure/transaction.js';

export class PgWorkspaceStore implements WorkspaceStore {
  constructor(private readonly pool: Pool) {}

  async listForUser(userId: string): Promise<Workspace[]> {
    const result = await this.pool.query<Workspace>(
      `SELECT w.id, w.name, w.slug, w.status, m.role FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id JOIN users u ON u.id = m.user_id
       WHERE m.user_id = $1 AND m.status = 'active' AND w.status = 'active'
       AND u.status = 'active' AND u.disabled_at IS NULL ORDER BY w.created_at, w.id`, [userId]);
    return result.rows;
  }

  async resolveContext(userId: string, workspaceId: string): Promise<WorkspaceContext | null> {
    const result = await this.pool.query<{ role: Role }>(
      `SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       JOIN users u ON u.id = m.user_id WHERE m.user_id = $1 AND m.workspace_id = $2
       AND m.status = 'active' AND w.status = 'active' AND u.status = 'active' AND u.disabled_at IS NULL`, [userId, workspaceId]);
    const role = result.rows[0]?.role;
    if (!role || !Object.hasOwn(permissions, role)) return null;
    return Object.freeze({ user_id: userId, workspace_id: workspaceId, role, permissions: permissions[role] });
  }

  async listAudit(workspaceId: string): Promise<AuditEvent[]> {
    const result = await this.pool.query<AuditEvent>(
      `SELECT id::text, workspace_id, actor_user_id, event, entity_type, entity_id, timestamp, metadata
       FROM audit_logs WHERE workspace_id = $1 ORDER BY id DESC LIMIT 100`, [workspaceId]);
    return result.rows;
  }

  async listMembers(workspaceId: string): Promise<Member[]> {
    const result = await this.pool.query<Member>(
      `SELECT m.id, m.user_id, u.name, u.email, m.role, m.status FROM workspace_members m
       JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.status = 'active'
       ORDER BY m.joined_at, m.id`, [workspaceId]);
    return result.rows;
  }

  private async lockOwner(client: PoolClient, context: WorkspaceContext): Promise<boolean> {
    const workspace = await client.query("SELECT id FROM workspaces WHERE id = $1 AND status = 'active' FOR UPDATE", [context.workspace_id]);
    if (!workspace.rowCount) return false;
    const result = await client.query(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
       JOIN users u ON u.id = m.user_id WHERE w.id = $1 AND w.status = 'active'
       AND m.user_id = $2 AND m.status = 'active' AND m.role = 'owner'
       AND u.status = 'active' AND u.disabled_at IS NULL FOR UPDATE OF m FOR SHARE OF u`,
      [context.workspace_id, context.user_id]);
    return Boolean(result.rowCount);
  }

  async inviteMember(context: WorkspaceContext, email: string, role: Role): Promise<MemberResult> {
    return transaction(this.pool, async (client) => {
      if (!await this.lockOwner(client, context)) return 'not_found';
      const user = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE lower(email) = $1 AND status = 'active' AND disabled_at IS NULL FOR SHARE", [email]);
      if (!user.rows[0]) return 'not_found';
      const member = await client.query<{ id: string }>(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', joined_at = now()
         WHERE workspace_members.status = 'removed' RETURNING id`, [context.workspace_id, user.rows[0].id, role]);
      if (!member.rows[0]) return 'already_member';
      await client.query(`INSERT INTO audit_logs (workspace_id, actor_user_id, event, entity_type, entity_id, metadata)
        VALUES ($1, $2, 'member.invited', 'workspace_member', $3, jsonb_build_object('role', $4::text))`,
      [context.workspace_id, context.user_id, member.rows[0].id, role]);
      return 'ok';
    });
  }

  async changeMember(context: WorkspaceContext, memberId: string, role: Role | null): Promise<MemberResult> {
    return transaction(this.pool, async (client) => {
      if (!await this.lockOwner(client, context)) return 'not_found';
      const target = await client.query<{ role: Role }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND id = $2 AND status = 'active' FOR UPDATE",
        [context.workspace_id, memberId]);
      if (!target.rows[0]) return 'not_found';
      if (target.rows[0].role === 'owner' && role !== 'owner') {
        const owners = await client.query<{ count: string }>(
          `SELECT count(*) FROM workspace_members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = $1 AND m.role = 'owner' AND m.status = 'active' AND m.id <> $2
           AND u.status = 'active' AND u.disabled_at IS NULL`, [context.workspace_id, memberId]);
        if (Number(owners.rows[0]!.count) === 0) return 'last_owner';
      }
      await client.query(role === null
        ? "UPDATE workspace_members SET status = 'removed' WHERE workspace_id = $1 AND id = $2"
        : 'UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND id = $2',
      role === null ? [context.workspace_id, memberId] : [context.workspace_id, memberId, role]);
      await client.query(`INSERT INTO audit_logs (workspace_id, actor_user_id, event, entity_type, entity_id, metadata)
        VALUES ($1, $2, $3, 'workspace_member', $4, jsonb_build_object('previous_role', $5::text, 'role', $6::text))`,
      [context.workspace_id, context.user_id, role === null ? 'member.removed' : 'member.role_changed',
        memberId, target.rows[0].role, role]);
      return 'ok';
    });
  }
}
