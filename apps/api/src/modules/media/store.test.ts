import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { AuthStore } from '../auth/domain/contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { createApp } from '../../app.js';
import { PgMediaStore } from './store.js';
import { validateImage } from './service.js';
import { maxUploadBodyBytes,type ValidatedImage } from './contracts.js';

describe('private media SQL and HTTP on PostgreSQL WASM', () => {
  const database = new PGlite(); let available = Promise.resolve();
  const query = async (sql: string,params?: unknown[]) => { const result = await database.query(sql,params); return { rows: result.rows,rowCount: result.rows.length || result.affectedRows || 0 }; };
  const pool = { query,connect: async () => { const previous = available; let release!: () => void;
    available = new Promise<void>((resolve) => { release = resolve; }); await previous; return { query,release }; } } as unknown as Pool;
  const store = new PgMediaStore(pool); let alice: WorkspaceContext; let bob: WorkspaceContext; let image: ValidatedImage;
  beforeAll(async () => {
    const directory = new URL('../../../../../packages/database/migrations/',import.meta.url);
    for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(file,directory),'utf-8'));
    const bytes = await sharp({ create: { width: 10,height: 6,channels: 3,background: '#a855f7' } }).png().toBuffer();
    image = await validateImage({ name: 'Private name',mimeType: 'image/png',dataBase64: bytes.toString('base64') });
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
  it('stores metadata and clean bytes with composite ownership and no content in listings/audits', async () => {
    const asset = await store.create(alice,image); expect(asset.byte_size).toBe(image.content.length);
    const loaded = (await store.get(alice,asset.id))!; expect(loaded.content.equals(image.content)).toBe(true);
    expect(await store.get(bob,asset.id)).toBeNull(); expect((await store.list(bob,0)).total).toBe(0);
    await expect(database.query('INSERT INTO media_contents (workspace_id,asset_id,content) VALUES ($1,$2,$3)',[bob.workspace_id,asset.id,image.content])).rejects.toThrow();
    expect(JSON.stringify(await store.list(alice,0))).not.toMatch(/content|dataBase64/);
    const audit = await database.query('SELECT metadata FROM audit_logs'); expect(JSON.stringify(audit.rows)).not.toMatch(/Private name|dataBase64/);
  });
  it('bounds pages at 50 and keeps accurate workspace totals', async () => {
    for (let index = 0; index < 51; index++) await store.create(alice,image);
    expect((await store.list(alice,0)).assets).toHaveLength(50);
    expect((await store.list(alice,50)).assets).toHaveLength(1);
    expect((await store.list(alice,50)).total).toBe(51);
  });
  it('rechecks revoked roles before persistence and permits readers only to read', async () => {
    const asset = await store.create(alice,image);
    await store.authorizeUpload(alice);
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    await expect(store.create(alice,image)).rejects.toMatchObject({ reason: 'forbidden' });
    expect((await store.get(alice,asset.id))?.asset.id).toBe(asset.id);
    await database.query("UPDATE users SET status='disabled' WHERE id=$1",[alice.user_id]);
    await expect(store.get(alice,asset.id)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('rolls back both metadata and bytes when the audit cannot be written', async () => {
    await database.exec("CREATE FUNCTION reject_media_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_media_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_media_audit()");
    try {
      await expect(store.create(alice,image)).rejects.toThrow();
      expect((await store.list(alice,0)).total).toBe(0);
      expect((await database.query<{ count: number }>('SELECT count(*)::int AS count FROM media_contents')).rows[0]?.count).toBe(0);
    } finally { await database.exec('DROP TRIGGER reject_media_audit ON audit_logs; DROP FUNCTION reject_media_audit()'); }
  });
  it('enforces HTTP auth, CSRF, limits and binary access with safe headers', async () => {
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const base = `/workspaces/${alice.workspace_id}/media`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    const payload = { name: 'Private name',mimeType: 'image/png',dataBase64: image.content.toString('base64') };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST',url: base,headers: { cookie: headers.cookie },payload })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST',url: base,headers,payload: { ...payload,url: 'http://127.0.0.1/internal' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST',url: base,headers: { ...headers,'content-type': 'application/json' },payload: ' '.repeat(maxUploadBodyBytes+1) })).statusCode).toBe(413);
      const uploaded = await app.inject({ method: 'POST',url: base,headers,payload }); expect(uploaded.statusCode).toBe(201);
      const id = uploaded.json().asset.id; expect(uploaded.body).not.toMatch(/dataBase64|content/);
      const content = await app.inject({ url: `${base}/${id}/content`,headers }); expect(content.statusCode).toBe(200);
      expect((await sharp(content.rawPayload).metadata()).width).toBe(10);
      expect(content.headers['cache-control']).toBe('no-store'); expect(content.headers['x-content-type-options']).toBe('nosniff');
      expect(content.headers['content-disposition']).toBe(`inline; filename="${id}.png"`);
      expect((await app.inject({ url: `${base}/${randomUUID()}/content`,headers })).statusCode).toBe(404);
      expect((await app.inject({ url: `${base.replace(alice.workspace_id,bob.workspace_id)}/${id}/content`,headers })).statusCode).toBe(404);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ url: base,headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST',url: base,headers,payload })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
