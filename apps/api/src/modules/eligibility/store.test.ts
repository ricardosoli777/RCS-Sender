import { randomBytes,randomUUID } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { CredentialCipher } from '@rcs/security';
import { MockRcsProvider,ProviderRegistry,activationChecks,type ProviderEvidence } from '@rcs/providers';
import { createApp } from '../../app.js';
import type { AuthStore } from '../auth/domain/contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { PgProviderStore } from '../providers/infrastructure/pg-provider-store.js';
import { PgContactStore } from '../contacts/store.js';
import { PgEligibilityStore } from './store.js';

describe('eligibility persistence and HTTP on PostgreSQL WASM', () => {
  const database = new PGlite(); let available = Promise.resolve();
  const query = async (sql: string,params?: unknown[]) => { const result = await database.query(sql,params); return { rows: result.rows,rowCount: result.rows.length || result.affectedRows || 0 }; };
  const pool = { query,connect: async () => { const previous = available; let release!: () => void;
    available = new Promise<void>((resolve) => { release = resolve; }); await previous; return { query,release }; } } as unknown as Pool;
  const cipher = new CredentialCipher('test',{ test: randomBytes(32) });
  const providers = new PgProviderStore(pool,cipher); const contacts = new PgContactStore(pool); const store = new PgEligibilityStore(pool);
  const credentials = { webhookSecret: 'synthetic-webhook-secret-at-least-32-characters' };
  let alice: WorkspaceContext; let bob: WorkspaceContext; let connectionId: string; let contactId: string; let version: string;
  beforeAll(async () => {
    const directory = new URL('../../../../../packages/database/migrations/',import.meta.url);
    for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(file,directory),'utf-8'));
  },30000);
  beforeEach(async () => {
    await database.exec('TRUNCATE users,workspaces CASCADE');
    const seed = async (name: string): Promise<WorkspaceContext> => {
      const user = randomUUID(); const workspace = randomUUID();
      await database.query('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)',[user,name,`${name}@example.test`,'unused']);
      await database.query('INSERT INTO workspaces (id,name,slug,created_by_user_id) VALUES ($1,$2,$3,$4)',[workspace,name,name,user]);
      await database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')",[workspace,user]);
      return { user_id: user,workspace_id: workspace,role: 'owner',permissions: ['providers.manage'] };
    };
    alice = await seed('alice'); bob = await seed('bob');
    await contacts.import(alice,[{ phone: '+5511912345678',name: 'Fixture' }],[]);
    contactId = (await contacts.snapshot(alice,0)).contacts[0]!.id;
    connectionId = (await providers.create(alice,{ providerId: 'mock',name: 'Fixture',environment: 'test',credentials })).id;
    const snapshot = (await providers.loadForProvider(alice,connectionId))!;
    await providers.recordConnectionTest(alice,connectionId,snapshot.credentialVersion,'connected');
    version = (await providers.loadForProvider(alice,connectionId))!.credentialVersion;
  });
  afterAll(async () => { await database.close(); });
  const eligible = { status: 'eligible',reason: 'provider_checked' } as const;
  it('rejects phone changes before reservation and invalidates changes during a provider query',async () => {
    const phone = '+5511912345678'; const changed = '+5511987654321';
    expect(await store.begin(alice,connectionId,contactId,version,changed)).toBeNull();
    const attempt = (await store.begin(alice,connectionId,contactId,version,phone))!;
    expect((await database.query<{ phone_normalized: string }>('SELECT phone_normalized FROM eligibility_checks')).rows[0]!.phone_normalized).toBe(phone);
    await database.query('UPDATE contacts SET phone_normalized=$1 WHERE id=$2',[changed,contactId]);
    expect(await store.save(alice,connectionId,contactId,version,attempt,eligible)).toMatchObject({ status: 'unknown',reason: 'contact_changed' });
    const next = (await store.begin(alice,connectionId,contactId,version,changed))!;
    expect(await store.save(alice,connectionId,contactId,version,next,eligible)).toMatchObject({ status: 'eligible',reason: 'provider_checked' });
    expect((await database.query<{ phone_normalized: string }>('SELECT phone_normalized FROM eligibility_checks')).rows[0]!.phone_normalized).toBe(changed);
  });
  it('keeps opt-out stronger than a changed-phone provider result',async () => {
    const attempt = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    await database.query("UPDATE contacts SET phone_normalized='+5511987654321' WHERE id=$1",[contactId]); await contacts.setOptOut(alice,contactId);
    expect(await store.save(alice,connectionId,contactId,version,attempt,eligible)).toMatchObject({ status: 'blocked',reason: 'opted_out' });
  });
  it('stores scoped, expiring results and rejects foreign contact/connection ownership', async () => {
    expect(await store.contact(bob,contactId)).toBeNull();
    expect(await store.begin(bob,connectionId,contactId,version,'+5511912345678')).toBeNull();
    const attempt = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    const saved = (await store.save(alice,connectionId,contactId,version,attempt,eligible))!;
    expect(saved.status).toBe('eligible'); expect(saved.expiresAt.getTime()-saved.checkedAt.getTime()).toBe(300000);
    const bobConnection = (await providers.create(bob,{ providerId: 'mock',name: 'B',environment: 'test',credentials })).id;
    await expect(database.query(`INSERT INTO eligibility_checks (workspace_id,connection_id,contact_id,credential_version,attempt_id,status,reason,expires_at)
      VALUES ($1,$2,$3,'version',$4,'unknown','unsupported',now()+interval '5 minutes')`,[alice.workspace_id,bobConnection,contactId,randomUUID()])).rejects.toThrow();
    const audit = await database.query("SELECT metadata FROM audit_logs WHERE event LIKE 'eligibility.%'");
    expect(JSON.stringify(audit.rows)).not.toMatch(/5511912345678|webhookSecret|synthetic|ciphertext/);
  });
  it('lets the latest attempt win and prevents repeated finalization', async () => {
    const older = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    const latest = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    expect(await store.save(alice,connectionId,contactId,version,older,eligible)).toBeNull();
    expect(await store.save(alice,connectionId,contactId,version,latest,eligible)).toMatchObject({ status: 'eligible' });
    expect(await store.save(alice,connectionId,contactId,version,latest,{ status: 'ineligible',reason: 'provider_checked' })).toBeNull();
  });
  it('rejects stale credentials and rechecks opt-out and connection status at commit', async () => {
    let attempt = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    await providers.updateCredentials(alice,connectionId,credentials);
    expect(await store.save(alice,connectionId,contactId,version,attempt,eligible)).toBeNull();
    version = (await providers.loadForProvider(alice,connectionId))!.credentialVersion;
    attempt = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    expect(await store.save(alice,connectionId,contactId,version,attempt,eligible)).toMatchObject({ status: 'unknown',reason: 'connection_unavailable' });
    attempt = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    await contacts.setOptOut(alice,contactId);
    expect(await store.save(alice,connectionId,contactId,version,attempt,eligible)).toMatchObject({ status: 'blocked',reason: 'opted_out' });
  });
  it('reauthorizes revoked roles and rolls back finalization when auditing fails', async () => {
    const attempt = (await store.begin(alice,connectionId,contactId,version,'+5511912345678'))!;
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    await expect(store.save(alice,connectionId,contactId,version,attempt,eligible)).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE workspace_members SET role='owner' WHERE workspace_id=$1",[alice.workspace_id]);
    await database.exec("CREATE FUNCTION reject_eligibility_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_eligibility_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_eligibility_audit()");
    try {
      await expect(store.save(alice,connectionId,contactId,version,attempt,eligible)).rejects.toThrow();
      await expect(store.begin(alice,connectionId,contactId,version,'+5511912345678')).rejects.toThrow();
      expect((await database.query<{ status: string }>('SELECT status FROM eligibility_checks')).rows[0]?.status).toBe('unknown');
    } finally { await database.exec('DROP TRIGGER reject_eligibility_audit ON audit_logs; DROP FUNCTION reject_eligibility_audit()'); }
    expect(await store.save(alice,connectionId,contactId,version,attempt,eligible)).toMatchObject({ status: 'eligible' });
  });
  it('enforces HTTP permissions, CSRF, schemas and isolation without requiring external APIs', async () => {
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const registry = new ProviderRegistry(); registry.register(new MockRcsProvider(),{ documentPath: 'docs/providers/mock.md',reviewedAt: '2026-10-03',references: ['https://example.test/local-fixture'],
      checks: Object.fromEntries(activationChecks.map((key) => [key,true])) as ProviderEvidence['checks'] });
    const app = createApp({ db: pool,redis,authStore,providerRegistry: registry,credentialCipher: cipher },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const url = `/workspaces/${alice.workspace_id}/providers/${connectionId}/eligibility`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ method: 'POST',url,headers: { origin: headers.origin,'x-rcs-request': '1' },payload: { contactId } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST',url,headers: { cookie: headers.cookie },payload: { contactId } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST',url,headers,payload: { contactId,credentials } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST',url,headers,payload: { contactId: randomUUID() } })).statusCode).toBe(404);
      const response = await app.inject({ method: 'POST',url,headers,payload: { contactId } });
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ status: 'unknown',reason: 'unsupported' });
      expect(response.body).not.toMatch(/credential|5511912345678|synthetic|attempt/); expect(response.headers['cache-control']).toBe('no-store');
      await database.query("UPDATE workspace_members SET role='operator' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ method: 'POST',url,headers,payload: { contactId } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
