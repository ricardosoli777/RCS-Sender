import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthStore, AuthUser, LoginUser, Registration } from '../domain/contracts.js';
import { transaction } from '../../shared/infrastructure/transaction.js';

export class PgAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async findUser(email: string): Promise<LoginUser | null> {
    const result = await this.pool.query<LoginUser>(
      'SELECT id, name, email, password_hash, status, disabled_at FROM users WHERE lower(email) = $1', [email]);
    return result.rows[0] ?? null;
  }

  async register(input: Registration, tokenHash: Buffer, expiresAt: Date): Promise<AuthUser | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<AuthUser>(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (lower(email)) DO NOTHING RETURNING id, name, email`, [input.name, input.email, input.passwordHash]);
      const user = result.rows[0];
      if (!user) return null;
      const workspace = await client.query<{ id: string }>(
        'INSERT INTO workspaces (name, slug, created_by_user_id) VALUES ($1, $2, $3) RETURNING id',
        [input.workspaceName, `workspace-${randomUUID()}`, user.id]);
      const workspaceId = workspace.rows[0]!.id;
      await client.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspaceId, user.id]);
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [user.id, tokenHash, expiresAt]);
      await client.query(`INSERT INTO audit_logs (workspace_id, actor_user_id, event, entity_type, entity_id)
        VALUES ($1::uuid, $2, 'workspace.created', 'workspace', $1::uuid::text)`, [workspaceId, user.id]);
      await client.query("INSERT INTO auth_audit_logs (actor_user_id, event_type) VALUES ($1, 'auth.registered')", [user.id]);
      return user;
    });
  }

  async createSession(user: LoginUser, tokenHash: Buffer, expiresAt: Date): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      const active = await client.query(
        `SELECT id FROM users WHERE id = $1 AND disabled_at IS NULL AND status = 'active'
         AND password_hash = $2 FOR SHARE`, [user.id, user.password_hash]);
      if (!active.rowCount) return false;
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [user.id, tokenHash, expiresAt]);
      await client.query("INSERT INTO auth_audit_logs (actor_user_id, event_type) VALUES ($1, 'auth.login_succeeded')", [user.id]);
      return true;
    });
  }

  async findSession(tokenHash: Buffer): Promise<AuthUser | null> {
    const result = await this.pool.query<AuthUser>(
      `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND u.disabled_at IS NULL AND u.status = 'active'`, [tokenHash]);
    return result.rows[0] ?? null;
  }

  async revokeSession(tokenHash: Buffer, actorId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
        [tokenHash, actorId]);
      if (result.rowCount) await client.query("INSERT INTO auth_audit_logs (actor_user_id, event_type) VALUES ($1, 'auth.logout')", [actorId]);
    });
  }

  async failedLogin(): Promise<void> {
    await this.pool.query("INSERT INTO auth_audit_logs (event_type) VALUES ('auth.login_failed')");
  }
}
