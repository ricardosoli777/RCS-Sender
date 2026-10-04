import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { CredentialCipher } from '@rcs/security';
import { PgProviderStore } from './pg-provider-store.js';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';

// Runs the production SQL on PostgreSQL WASM. One connection is serialized;
// native multi-session locking remains covered separately by service CI tests.
describe('provider persistence on local PostgreSQL WASM', () => {
  const database = new PGlite();
  let available = Promise.resolve();
  const pool = { connect: async () => {
    const previous = available; let release!: () => void;
    available = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return { release, query: async (sql: string, params?: unknown[]) => {
      const result = await database.query(sql, params);
      return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
    } };
  } } as unknown as Pool;
  const cipher = new CredentialCipher('local', { local: randomBytes(32) });
  const store = new PgProviderStore(pool, cipher);
  let alice: WorkspaceContext; let bob: WorkspaceContext;
  const credentials = { apiKey: 'synthetic-secret' };
  const input = { providerId: 'bound_fixture', name: 'Bound fixture', environment: 'test', credentials, externalAgentId: 'signed-agent-a' };
  beforeAll(async () => {
    const directory = new URL('../../../../../../packages/database/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(file, directory), 'utf-8'));
  }, 30000);
  beforeEach(async () => {
    await database.exec('TRUNCATE audit_logs, provider_credentials, provider_connections, workspace_members, workspaces, sessions, users CASCADE');
    const seed = async (name: string): Promise<WorkspaceContext> => {
      const user = randomUUID(); const workspace = randomUUID();
      await database.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1,$2,$3,$4)', [user, name, `${name}@example.test`, 'unused-test-hash']);
      await database.query('INSERT INTO workspaces (id,name,slug,created_by_user_id) VALUES ($1,$2,$3,$4)', [workspace, name, name, user]);
      await database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')", [workspace, user]);
      return { user_id: user, workspace_id: workspace, role: 'owner', permissions: ['providers.manage'] };
    };
    alice = await seed('alice'); bob = await seed('bob');
  });
  afterAll(async () => { await database.close(); });
  it('reserves identities globally across workspaces and environments with atomic rollback', async () => {
    const results = await Promise.allSettled([store.create(alice, input), store.create(bob, { ...input, environment: 'production' })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { message: 'Vínculo de agente indisponível.' } });
    const count = await database.query<{ count: string }>('SELECT count(*)::text AS count FROM provider_connections');
    expect(count.rows[0]?.count).toBe('1');
    expect((await database.query<{ count: string }>('SELECT count(*)::text AS count FROM provider_credentials')).rows[0]?.count).toBe('1');
    expect((await database.query<{ count: string }>('SELECT count(*)::text AS count FROM audit_logs')).rows[0]?.count).toBe('1');
    // Different providers can use the same external identifier.
    await expect(store.create(bob, { ...input, providerId: 'other_fixture' })).resolves.toMatchObject({ external_agent_id: input.externalAgentId });
  });
  it('keeps identity immutable while rotating encrypted credentials and resets verification', async () => {
    const connection = await store.create(alice, input);
    const loaded = (await store.loadForProvider(alice, connection.id))!;
    expect(await store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'connected')).toBe(true);
    await expect(store.updateCredentials(alice, connection.id, { apiKey: 'new-secret' }, input.externalAgentId)).resolves.toBe(true);
    await expect(store.updateCredentials(alice, connection.id, credentials, 'other-agent')).rejects.toThrow('Vínculo de agente indisponível.');
    await expect(store.updateCredentials(alice, connection.id, credentials)).rejects.toThrow('Vínculo de agente indisponível.');
    const current = (await store.loadForProvider(alice, connection.id))!;
    expect(current.credentials.apiKey).toBe('new-secret'); expect(current.connection.status).toBe('unverified');
    expect(current.connection.external_agent_id).toBe(input.externalAgentId);
    expect(await store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'connected')).toBe(false);
  });
  it('blocks stale test results after another test commits and isolates all result writes', async () => {
    const connection = await store.create(alice, input); const loaded = (await store.loadForProvider(alice, connection.id))!;
    expect(await store.loadForProvider(bob, connection.id)).toBeNull();
    expect(await store.recordConnectionTest(bob, connection.id, loaded.credentialVersion, 'connected')).toBe(false);
    expect(await store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'connected')).toBe(true);
    expect(await store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'disconnected')).toBe(false);
    expect((await store.list(alice))[0]?.status).toBe('connected');
    expect(JSON.stringify(await store.list(alice))).not.toMatch(/synthetic-secret|credentialVersion|ciphertext/);
  });
  it('rechecks membership after the external call and refuses disabled connections', async () => {
    const connection = await store.create(alice, input); const loaded = (await store.loadForProvider(alice, connection.id))!;
    await database.query("UPDATE workspace_members SET role = 'viewer' WHERE workspace_id = $1 AND user_id = $2", [alice.workspace_id, alice.user_id]);
    await expect(store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'connected')).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2", [alice.workspace_id, alice.user_id]);
    await database.query("UPDATE provider_connections SET status = 'disabled' WHERE id = $1", [connection.id]);
    expect(await store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'connected')).toBe(false);
    expect((await store.list(alice))[0]?.status).toBe('disabled');
  });
  it('rolls back status and audit together and releases a reservation when creation rolls back', async () => {
    const connection = await store.create(alice, input); const loaded = (await store.loadForProvider(alice, connection.id))!;
    await database.exec("CREATE FUNCTION reject_provider_audit_local() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_provider_audit_local BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_provider_audit_local()");
    try {
      await expect(store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'connected')).rejects.toThrow('audit unavailable');
      await expect(store.create(alice, { ...input, externalAgentId: 'rollback-agent' })).rejects.toThrow('audit unavailable');
      expect((await store.list(alice))[0]?.status).toBe('unverified');
    } finally { await database.exec('DROP TRIGGER reject_provider_audit_local ON audit_logs; DROP FUNCTION reject_provider_audit_local()'); }
    await expect(store.create(bob, { ...input, externalAgentId: 'rollback-agent' })).resolves.toMatchObject({ external_agent_id: 'rollback-agent' });
    expect(await store.recordConnectionTest(alice, connection.id, loaded.credentialVersion, 'connected')).toBe(true);
    const audit = await database.query<{ event: string }>('SELECT event FROM audit_logs ORDER BY id');
    expect(audit.rows.map((row) => row.event)).toEqual(['provider.connection_created', 'provider.connection_created', 'provider.connected']);
  });
  it('binds legacy unbound connections transactionally and rejects invalid or occupied identities', async () => {
    const legacy = await store.create(alice, { ...input, externalAgentId: undefined });
    const occupied = await store.create(bob, input);
    await expect(store.updateCredentials(alice, legacy.id, credentials, input.externalAgentId)).rejects.toThrow('Vínculo de agente indisponível.');
    expect((await store.list(alice))[0]?.external_agent_id).toBeNull();
    await expect(store.updateCredentials(alice, legacy.id, credentials, 'legacy-agent')).resolves.toBe(true);
    expect((await store.list(alice))[0]?.external_agent_id).toBe('legacy-agent');
    await expect(store.create(alice, { ...input, externalAgentId: '   ' })).rejects.toThrow('Vínculo de agente indisponível.');
    await expect(store.create(alice, { ...input, externalAgentId: 'x'.repeat(257) })).rejects.toThrow('Vínculo de agente indisponível.');
    expect(occupied.external_agent_id).toBe(input.externalAgentId);
  });
});
