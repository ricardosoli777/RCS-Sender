import { randomUUID, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { migrate } from '@rcs/database';
import { CredentialCipher, hashPassword } from '@rcs/security';
import { ProviderRegistry, activationChecks, capabilityMatrix, type RcsProvider, type ProviderEvidence } from '@rcs/providers';
import { PgProviderStore } from './modules/providers/infrastructure/pg-provider-store.js';
import { PgAuthStore } from './modules/auth/infrastructure/pg-auth-store.js';
import { PgWorkspaceStore } from './modules/workspaces/infrastructure/pg-workspace-store.js';
import { hashToken } from './modules/auth/application/auth-service.js';
import { createApp } from './app.js';

describe('provider connections with PostgreSQL and Redis', () => {
  it.skipIf(process.env.RUN_SERVICE_TESTS !== '1')('encrypts credentials, prevents tenant swaps, reauthorizes writes and rolls back failed audit', async () => {
    const schema = `providers_test_${randomUUID().replaceAll('-', '')}`;
    const control = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    const oldKey = randomBytes(32); const newKey = randomBytes(32);
    const cipher = new CredentialCipher('old', { old: oldKey });
    const store = new PgProviderStore(db, cipher);
    // Inject a local fixture into this test only; production has no activated adapters yet.
    const unsupported = async () => { throw new Error('Test fixture has no network implementation'); };
    const adapter: RcsProvider = { getProviderMetadata: () => ({ id: 'test_fixture', name: 'Local fixture', environments: ['test'], credentialSchema: [{ key: 'apiKey', label: 'Test key', required: true, secret: true }] }),
      getProviderCapabilities: () => capabilityMatrix(), getProviderLimits: () => ({}), validateCredentials: (value) => Boolean(value.apiKey),
      testConnection: async () => ({ status: 'connected' }), getConnectionStatus: unsupported, listAgents: unsupported, getAgent: unsupported, getAgentCapabilities: unsupported,
      send: unsupported, verifyWebhook: unsupported, parseWebhook: unsupported, normalizeEvent: () => null, getHealth: unsupported };
    const registry = new ProviderRegistry();
    registry.register(adapter, { documentPath: 'docs/providers/test-fixture.md', reviewedAt: '2026-10-03', references: ['https://example.test/local-fixture'], checks: Object.fromEntries(activationChecks.map((key) => [key, true])) as ProviderEvidence['checks'] });
    const app = createApp({ db, redis, credentialCipher: cipher, providerRegistry: registry }, { appUrl: 'http://localhost:3000', secureCookies: false });
    try {
      await control.query(`CREATE SCHEMA ${schema}`); await migrate(db);
      const auth = new PgAuthStore(db); const workspaces = new PgWorkspaceStore(db);
      const passwordHash = await hashPassword('integration-password-long');
      const tokenA = randomBytes(32).toString('base64url'); const tokenB = randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + 120000);
      const alice = (await auth.register({ name: 'Alice', email: 'alice-provider@example.test', passwordHash, workspaceName: 'A' }, hashToken(tokenA), expires))!;
      const bob = (await auth.register({ name: 'Bob', email: 'bob-provider@example.test', passwordHash, workspaceName: 'B' }, hashToken(tokenB), expires))!;
      const workspaceA = (await workspaces.listForUser(alice.id))[0]!; const workspaceB = (await workspaces.listForUser(bob.id))[0]!;
      const contextA = (await workspaces.resolveContext(alice.id, workspaceA.id))!;
      const contextB = (await workspaces.resolveContext(bob.id, workspaceB.id))!;
      const credentials = { apiKey: 'test-only-provider-secret' };
      const mutationHeaders = { cookie: `rcs_session=${tokenA}`, origin: 'http://localhost:3000', 'x-rcs-request': '1' };
      const created = await app.inject({ method: 'POST', url: `/workspaces/${workspaceA.id}/providers`, headers: mutationHeaders,
        payload: { providerId: 'test_fixture', name: 'Fixture A', environment: 'test', credentials } });
      expect(created.statusCode).toBe(201); expect(created.body).not.toMatch(/ciphertext|apiKey|test-only-provider-secret/);
      const connectionA = created.json().connection;
      const connectionB = await store.create(contextB, { providerId: 'test_fixture', name: 'Fixture B', environment: 'test', credentials });
      expect(connectionA.status).toBe('unverified');
      expect((await store.list(contextA)).map((connection) => connection.id)).toEqual([connectionA.id]);
      expect(JSON.stringify(await store.list(contextA))).not.toContain(credentials.apiKey);
      expect((await store.loadForProvider(contextA, connectionA.id))?.credentials).toEqual(credentials);
      const replaced = await app.inject({ method: 'PUT', url: `/workspaces/${workspaceA.id}/providers/${connectionA.id}/credentials`, headers: mutationHeaders, payload: { credentials } });
      expect(replaced.statusCode).toBe(204); expect(replaced.body).toBe('');
      const testUrl = `/workspaces/${workspaceA.id}/providers/${connectionA.id}/test`;
      expect((await app.inject({ method: 'POST', url: testUrl, headers: { cookie: mutationHeaders.cookie }, payload: {} })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: testUrl, headers: { ...mutationHeaders, cookie: `rcs_session=${tokenB}` }, payload: {} })).statusCode).toBe(404);
      const tested = await app.inject({ method: 'POST', url: testUrl, headers: mutationHeaders, payload: {} });
      expect(tested.statusCode).toBe(200); expect(tested.json()).toEqual({ status: 'connected' });
      const testedSnapshot = (await store.loadForProvider(contextA, connectionA.id))!;
      expect(testedSnapshot.connection.status).toBe('connected');
      expect(await store.loadForProvider(contextB, connectionA.id)).toBeNull();
      expect(await store.updateCredentials(contextB, connectionA.id, { apiKey: 'wrong-tenant' })).toBe(false);
      const encrypted = (await db.query('SELECT ciphertext FROM provider_credentials WHERE workspace_id = $1 AND connection_id = $2', [workspaceA.id, connectionA.id])).rows[0].ciphertext;
      expect(encrypted).not.toContain(credentials.apiKey); expect(encrypted).toMatch(/^v1:old:/);
      await expect(db.query('INSERT INTO provider_credentials (workspace_id, connection_id, ciphertext) VALUES ($1, $2, $3)', [workspaceB.id, connectionA.id, encrypted])).rejects.toThrow();
      await db.query('UPDATE provider_credentials SET ciphertext = $3 WHERE workspace_id = $1 AND connection_id = $2', [workspaceB.id, connectionB.id, encrypted]);
      await expect(store.loadForProvider(contextB, connectionB.id)).rejects.toThrow('Não foi possível decifrar');
      const rotatedStore = new PgProviderStore(db, new CredentialCipher('new', { old: oldKey, new: newKey }));
      expect((await rotatedStore.loadForProvider(contextA, connectionA.id))?.credentials).toEqual(credentials);
      await rotatedStore.updateCredentials(contextA, connectionA.id, { apiKey: 'replacement-test-secret' });
      expect(await store.recordConnectionTest(contextA, connectionA.id, testedSnapshot.credentialVersion, 'connected')).toBe(false);
      const newStore = new PgProviderStore(db, new CredentialCipher('new', { new: newKey }));
      expect((await newStore.loadForProvider(contextA, connectionA.id))?.credentials.apiKey).toBe('replacement-test-secret');
      const list = await app.inject({ url: `/workspaces/${workspaceA.id}/providers`, headers: { cookie: `rcs_session=${tokenA}` } });
      expect(list.statusCode).toBe(200); expect(list.body).not.toMatch(/ciphertext|apiKey|replacement-test-secret/);
      expect((await app.inject({ url: `/workspaces/${workspaceA.id}/providers`, headers: { cookie: `rcs_session=${tokenB}` } })).statusCode).toBe(404);
      expect((await app.inject({ url: `/workspaces/${workspaceA.id}/providers/catalog`, headers: { cookie: `rcs_session=${tokenA}` } })).json().providers[0]).toMatchObject({ active: true });
      const blocked = await app.inject({ method: 'POST', url: `/workspaces/${workspaceA.id}/providers`, headers: mutationHeaders, payload: { providerId: 'unregistered', name: 'Not activated', environment: 'test', credentials } });
      expect(blocked.statusCode).toBe(409); expect(blocked.body).not.toContain(credentials.apiKey);
      // Audit failure rolls back the connection and encrypted credentials together.
      await db.query(`CREATE FUNCTION reject_provider_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
      await db.query('CREATE TRIGGER reject_provider_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_provider_audit()');
      await expect(store.create(contextA, { providerId: 'test_fixture', name: 'Rollback', environment: 'test', credentials })).rejects.toThrow();
      expect((await store.list(contextA)).length).toBe(1);
      await expect(store.updateCredentials(contextA, connectionA.id, { apiKey: 'rollback-secret' })).rejects.toThrow();
      expect((await newStore.loadForProvider(contextA, connectionA.id))?.credentials.apiKey).toBe('replacement-test-secret');
      await db.query('DROP TRIGGER reject_provider_audit ON audit_logs');
      await workspaces.inviteMember(contextA, bob.email, 'admin');
      const adminContext = (await workspaces.resolveContext(bob.id, workspaceA.id))!;
      expect((await store.list(adminContext)).length).toBe(1);
      const bobMember = (await workspaces.listMembers(workspaceA.id)).find((member) => member.user_id === bob.id)!;
      await workspaces.changeMember(contextA, bobMember.id, 'viewer');
      await expect(store.updateCredentials(adminContext, connectionA.id, credentials)).rejects.toMatchObject({ reason: 'forbidden' });
      expect((await app.inject({ url: `/workspaces/${workspaceA.id}/providers`, headers: { cookie: `rcs_session=${tokenB}` } })).statusCode).toBe(403);
      await workspaces.changeMember(contextA, bobMember.id, null);
      await expect(store.loadForProvider(adminContext, connectionA.id)).rejects.toMatchObject({ reason: 'not_found' });
      const audit = await workspaces.listAudit(workspaceA.id);
      expect(audit.filter((event) => event.event.startsWith('provider.')).map((event) => event.event)).toEqual(['provider.credentials_updated', 'provider.connected', 'provider.credentials_updated', 'provider.connection_created']);
      expect(JSON.stringify(audit)).not.toMatch(/test-only-provider-secret|replacement-test-secret|apiKey|ciphertext/);
      // Distinct PostgreSQL sessions race for the same global reservation.
      const reservations = await Promise.allSettled([contextA, contextB].map((context) => store.create(context, {
        providerId: 'test_fixture', name: 'Exclusive agent', environment: 'test', credentials, externalAgentId: 'same-signed-agent'
      })));
      expect(reservations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(reservations.find((result) => result.status === 'rejected')).toMatchObject({ reason: { message: 'Vínculo de agente indisponível.' } });
      const winner = reservations.find((result) => result.status === 'fulfilled')!;
      if (winner.status === 'fulfilled') {
        const context = winner.value.workspace_id === workspaceA.id ? contextA : contextB;
        await expect(store.updateCredentials(context, winner.value.id, credentials, 'different-agent')).rejects.toThrow('Vínculo de agente indisponível.');
      }
      const twilioInput={accountSid:`AC${'a'.repeat(32)}`,authToken:'local-only-callback-test',sender:'fixture-sender',webhookUrl:`https://example.test/webhooks/rcs/twilio?connectionId=${randomUUID()}`};
      const twilio=await store.create(contextA,{providerId:'twilio',name:'Callback binding',environment:'test',credentials:twilioInput,externalAgentId:'fixture-sender'});
      expect(new URL((await store.loadForProvider(contextA,twilio.id))!.credentials.webhookUrl!).searchParams.get('connectionId')).toBe(twilio.id);
      await store.updateCredentials(contextA,twilio.id,twilioInput,'fixture-sender');
      expect(new URL((await store.loadForProvider(contextA,twilio.id))!.credentials.webhookUrl!).searchParams.get('connectionId')).toBe(twilio.id);
    } finally {
      await app.close(); await db.end(); await redis.quit().catch(() => redis.disconnect());
      await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await control.end();
    }
  }, 30000);
});
