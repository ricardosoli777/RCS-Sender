import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { AuthStore } from '../auth/domain/contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { createApp } from '../../app.js';
import { PgMessageStore } from './store.js';
import type { MessageInput } from './contracts.js';

describe('versioned messages SQL and HTTP on PostgreSQL WASM',() => {
  const database = new PGlite(); let available = Promise.resolve();
  const query = async (sql: string,params?: unknown[]) => { const result = await database.query(sql,params); return { rows: result.rows,rowCount: result.rows.length || result.affectedRows || 0 }; };
  const pool = { query,connect: async () => { const previous = available; let release!: () => void;
    available = new Promise<void>((resolve) => { release = resolve; }); await previous; return { query,release }; } } as unknown as Pool;
  const store = new PgMessageStore(pool); let alice: WorkspaceContext; let bob: WorkspaceContext;
  const input: MessageInput = { name: 'Welcome',purpose: 'marketing',content: { type: 'text',text: 'Private message body' } };
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
      return { user_id: user,workspace_id: workspace,role: 'owner',permissions: ['messages.manage','messages.view'] };
    };
    alice = await seed('alice'); bob = await seed('bob');
  });
  afterAll(async () => { await database.close(); });
  it('keeps active snapshots stable until explicit activation and makes history immutable',async () => {
    const created = await store.create(alice,input); const id = created.message.id;
    expect(created.message.status).toBe('draft'); expect(created.active).toBeNull();
    await store.changeStatus(alice,id,1,'active');
    const revised = await store.revise(alice,id,1,{ ...input,name: 'Updated',purpose: 'transactional',content: { type: 'text',text: 'New body' } });
    expect(revised.current.version).toBe(2); expect(revised.active).toMatchObject({ version: 1,name: 'Welcome',purpose: 'marketing',content: input.content });
    expect((await store.changeStatus(alice,id,2,'active')).active?.id).toBe(revised.current.id);
    expect((await store.version(alice,id,1))?.content).toEqual(input.content);
    await expect(database.query('UPDATE message_versions SET name=$1 WHERE id=$2',['changed',created.current.id])).rejects.toThrow('immutable');
    await expect(database.query('DELETE FROM message_versions WHERE id=$1',[created.current.id])).rejects.toThrow('immutable');
    expect(JSON.stringify((await database.query('SELECT metadata FROM audit_logs')).rows)).not.toMatch(/Private message|New body|Welcome/);
  });
  it('rejects stale edits and requires restoring archived messages before activation',async () => {
    const { message } = await store.create(alice,input);
    await store.revise(alice,message.id,1,input);
    await expect(store.revise(alice,message.id,1,input)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(store.changeStatus(alice,message.id,1,'active')).rejects.toMatchObject({ reason: 'conflict' });
    await store.changeStatus(alice,message.id,2,'archived');
    await expect(store.revise(alice,message.id,2,input)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(store.changeStatus(alice,message.id,2,'active')).rejects.toMatchObject({ reason: 'conflict' });
    await store.changeStatus(alice,message.id,2,'draft'); expect((await store.changeStatus(alice,message.id,2,'active')).active?.version).toBe(2);
  });
  it('isolates historical versions and rechecks current member permissions',async () => {
    const { message } = await store.create(alice,input);
    expect(await store.get(bob,message.id)).toBeNull(); expect(await store.version(bob,message.id,1)).toBeNull();
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    expect((await store.get(alice,message.id))?.message.id).toBe(message.id);
    await expect(store.revise(alice,message.id,1,input)).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE users SET status='disabled' WHERE id=$1",[alice.user_id]);
    await expect(store.version(alice,message.id,1)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('rejects foreign or mismatched media and protects referenced assets',async () => {
    const assetId = randomUUID();
    await database.query("INSERT INTO media_assets (id,workspace_id,name,mime_type,byte_size,width,height,sha256,created_by_user_id) VALUES ($1,$2,'Image','image/png',1,1,1,$3,$4)",[assetId,alice.workspace_id,'a'.repeat(64),alice.user_id]);
    const card: MessageInput = { ...input,content: { type: 'rich_card',card: { title: 'Title',body: 'Body',media: { assetId,mimeType: 'image/png' } } } };
    await expect(store.create(bob,card)).rejects.toMatchObject({ reason: 'invalid' });
    await expect(store.create(alice,{ ...input,content: { type: 'rich_card',card: { title: 'Title',body: 'Body',media: { assetId,mimeType: 'image/jpeg' } } } })).rejects.toMatchObject({ reason: 'invalid' });
    expect((await store.list(alice,0)).total).toBe(0);
    await store.create(alice,card);
    await expect(database.query('DELETE FROM media_assets WHERE id=$1',[assetId])).rejects.toThrow();
  });
  it('rolls back revisions and status when audit persistence fails',async () => {
    const { message } = await store.create(alice,input);
    await database.exec("CREATE FUNCTION reject_message_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_message_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_message_audit()");
    try {
      await expect(store.revise(alice,message.id,1,input)).rejects.toThrow();
      await expect(store.changeStatus(alice,message.id,1,'active')).rejects.toThrow();
      await expect(store.create(alice,input)).rejects.toThrow();
      expect((await store.get(alice,message.id))?.message).toMatchObject({ current_version: 1,status: 'draft' });
      expect(await store.version(alice,message.id,2)).toBeNull(); expect((await store.list(alice,0)).total).toBe(1);
    } finally { await database.exec('DROP TRIGGER reject_message_audit ON audit_logs; DROP FUNCTION reject_message_audit()'); }
  });
  it('paginates metadata and filters status within the workspace',async () => {
    for (let index = 0; index < 51; index++) await store.create(alice,input);
    const first = await store.list(alice,0); expect(first.messages).toHaveLength(50); expect(first.total).toBe(51);
    expect((await store.list(alice,50)).messages).toHaveLength(1);
    await store.changeStatus(alice,first.messages[0]!.id,1,'active');
    expect((await store.list(alice,0,'active')).total).toBe(1); expect((await store.list(bob,0)).total).toBe(0);
    expect(JSON.stringify(first)).not.toContain('Private message body');
  });
  it('enforces HTTP auth, CSRF, strict payloads, conflicts and historical access',async () => {
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const base = `/workspaces/${alice.workspace_id}/messages`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST',url: base,headers: { cookie: headers.cookie },payload: input })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST',url: base,headers,payload: { ...input,extra: true } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST',url: base,headers: { ...headers,'content-type': 'application/json' },payload: ' '.repeat(65537) })).statusCode).toBe(413);
      const created = await app.inject({ method: 'POST',url: base,headers,payload: input }); expect(created.statusCode).toBe(201);
      const id = created.json().message.id;
      expect((await app.inject({ method: 'PUT',url: `${base}/${id}`,headers,payload: { ...input,expectedVersion: 1 } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT',url: `${base}/${id}`,headers,payload: { ...input,expectedVersion: 1 } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'PATCH',url: `${base}/${id}/status`,headers,payload: { expectedVersion: 2,status: 'active' } })).statusCode).toBe(200);
      expect((await app.inject({ url: `${base}/${id}/versions/1`,headers })).json().version.content).toEqual(input.content);
      expect((await app.inject({ url: `${base}/${id}/versions/3`,headers })).statusCode).toBe(404);
      expect((await app.inject({ url: `${base.replace(alice.workspace_id,bob.workspace_id)}/${id}`,headers })).statusCode).toBe(404);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ url: base,headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PATCH',url: `${base}/${id}/status`,headers,payload: { expectedVersion: 2,status: 'draft' } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
