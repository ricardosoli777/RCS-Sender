import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { migrate } from '@rcs/database';
import { hashPassword } from '@rcs/security';
import { createApp } from './app.js';
import { PgAuthStore } from './modules/auth/infrastructure/pg-auth-store.js';
import { PgWorkspaceStore } from './modules/workspaces/infrastructure/pg-workspace-store.js';
import { hashToken } from './modules/auth/application/auth-service.js';

describe('authentication and workspace isolation with PostgreSQL and Redis', () => {
  it.skipIf(process.env.RUN_SERVICE_TESTS !== '1')('keeps memberships, audit, sessions and mutations scoped and transactional', async () => {
    const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
    const control = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    const app = createApp({ db, redis }, { appUrl: 'http://localhost:3000', secureCookies: false });
    try {
      await control.query(`CREATE SCHEMA ${schema}`);
      await migrate(db);
      expect(await migrate(db)).toEqual([]);
      const passwordHash = await hashPassword('integration-password-long');
      const auth = new PgAuthStore(db);
      const workspaces = new PgWorkspaceStore(db);
      const aliceHash = hashToken(randomBytes(32).toString('base64url'));
      const bobToken = randomBytes(32).toString('base64url');
      const bobHash = hashToken(bobToken);
      const expires = new Date(Date.now() + 60000);
      const alice = (await auth.register({ name: 'Alice', email: 'alice@example.test', passwordHash, workspaceName: 'Workspace A' }, aliceHash, expires))!;
      const bob = (await auth.register({ name: 'Bob', email: 'bob@example.test', passwordHash, workspaceName: 'Workspace B' }, bobHash, expires))!;
      const workspaceA = (await workspaces.listForUser(alice.id))[0]!;
      const workspaceB = (await workspaces.listForUser(bob.id))[0]!;
      expect(workspaceA.role).toBe('owner');
      expect(workspaceA.id).not.toBe(workspaceB.id);
      const contextA = (await workspaces.resolveContext(alice.id, workspaceA.id))!;
      const contextB = (await workspaces.resolveContext(bob.id, workspaceB.id))!;
      expect(await workspaces.resolveContext(bob.id, workspaceA.id)).toBeNull();
      expect((await workspaces.listAudit(workspaceA.id)).every((event) => event.workspace_id === workspaceA.id)).toBe(true);
      const foreign = await app.inject({ url: `/workspaces/${workspaceA.id}/audit`, headers: { cookie: `rcs_session=${bobToken}` } });
      expect(foreign.statusCode).toBe(404);
      const foreignMutation = await app.inject({ method: 'POST', url: `/workspaces/${workspaceA.id}/members`,
        headers: { cookie: `rcs_session=${bobToken}`, origin: 'http://localhost:3000', 'x-rcs-request': '1' },
        payload: { email: 'bob@example.test', role: 'owner' } });
      expect(foreignMutation.statusCode).toBe(404);
      expect(await workspaces.inviteMember(contextA, bob.email, 'viewer')).toBe('ok');
      expect((await workspaces.resolveContext(bob.id, workspaceA.id))!.role).toBe('viewer');
      const viewerAudit = await app.inject({ url: `/workspaces/${workspaceA.id}/audit`, headers: { cookie: `rcs_session=${bobToken}` } });
      expect(viewerAudit.statusCode).toBe(403);
      const memberA = (await workspaces.listMembers(workspaceA.id)).find((member) => member.user_id === alice.id)!;
      const memberBobA = (await workspaces.listMembers(workspaceA.id)).find((member) => member.user_id === bob.id)!;
      const memberBobB = (await workspaces.listMembers(workspaceB.id))[0]!;
      expect(await workspaces.changeMember(contextA, memberBobB.id, 'owner')).toBe('not_found');
      expect(await workspaces.changeMember(contextA, memberA.id, 'viewer')).toBe('last_owner');
      expect(await workspaces.changeMember(contextA, memberBobA.id, 'admin')).toBe('ok');
      expect((await workspaces.resolveContext(bob.id, workspaceA.id))!.permissions).not.toContain('members.manage');
      expect(await workspaces.changeMember(contextA, memberBobA.id, null)).toBe('ok');
      expect(await workspaces.resolveContext(bob.id, workspaceA.id)).toBeNull();
      expect((await workspaces.resolveContext(bob.id, workspaceB.id))!.role).toBe('owner');

      // A failed audit write must roll back the entire registration.
      await db.query(`CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test audit unavailable'; END $$`);
      await db.query('CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit()');
      await expect(auth.register({ name: 'Failed', email: 'failed@example.test', passwordHash, workspaceName: 'Failed' },
        hashToken(randomBytes(32).toString('base64url')), expires)).rejects.toThrow();
      expect(await auth.findUser('failed@example.test')).toBeNull();
      expect((await db.query('SELECT count(*)::int AS count FROM workspaces')).rows[0].count).toBe(2);
      await db.query('DROP TRIGGER reject_audit ON audit_logs');
      expect(await auth.register({ name: 'Duplicate', email: 'ALICE@example.test', passwordHash, workspaceName: 'Duplicate' },
        hashToken(randomBytes(32).toString('base64url')), expires)).toBeNull();

      expect(await auth.findSession(bobHash)).toEqual(bob);
      await db.query("UPDATE workspaces SET status = 'suspended' WHERE id = $1", [workspaceB.id]);
      expect(await workspaces.resolveContext(bob.id, workspaceB.id)).toBeNull();
      await db.query("UPDATE users SET status = 'disabled' WHERE id = $1", [bob.id]);
      expect(await auth.findSession(bobHash)).toBeNull();
      await db.query("UPDATE users SET status = 'active' WHERE id = $1", [bob.id]);
      await db.query('UPDATE sessions SET expires_at = now() - interval \'1 second\' WHERE token_hash = $1', [bobHash]);
      expect(await auth.findSession(bobHash)).toBeNull();
      await auth.revokeSession(aliceHash, alice.id);
      expect(await auth.findSession(aliceHash)).toBeNull();
      expect(contextB.workspace_id).toBe(workspaceB.id);
      const allAudit = await db.query('SELECT workspace_id, metadata FROM audit_logs');
      expect(allAudit.rows.every((event) => event.workspace_id)).toBe(true);
      expect(JSON.stringify(allAudit.rows)).not.toContain(passwordHash);
    } finally {
      await app.close();
      await db.end();
      redis.disconnect();
      await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await control.end();
    }
  }, 30000);
});
