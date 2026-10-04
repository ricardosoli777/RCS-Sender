import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { AuthStore } from '../auth/domain/contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { createApp } from '../../app.js';
import { PgContactStore } from './store.js';
import { ContactService, normalizeContact, parseContactText } from './service.js';

describe('contact normalization and imports', () => {
  it('normalizes formatted Brazilian and international phones without extracting arbitrary text', () => {
    expect(normalizeContact({ phone: '(11) 91234-5678', name: ' Ana ' })).toEqual({ phone: '+5511912345678', name: 'Ana' });
    expect(normalizeContact({ phone: '+1 213 373 4253' }).phone).toBe('+12133734253');
    for (const phone of ['123', 'ligue 11912345678', '+55 11 91234-5678 ext 12', '11912345678<script>', '٠١٢٣']) expect(() => normalizeContact({ phone })).toThrow();
    expect(() => normalizeContact({ phone: '11912345678', name: 'bad\u0000name' })).toThrow();
  });
  it('parses BOM, headers, semicolons, tabulation, quoted delimiters and escaped quotes', () => {
    expect(parseContactText('\uFEFFtelefone,nome\r\n11912345678,"Ana, Silva"\r\n21912345678,"Nome ""teste"""')).toEqual([
      { phone: '11912345678', name: 'Ana, Silva' }, { phone: '21912345678', name: 'Nome "teste"' }
    ]);
    expect(parseContactText('telefone;nome\n11912345678;Ana')).toEqual([{ phone: '11912345678', name: 'Ana' }]);
    expect(parseContactText('11912345678\tAna')).toEqual([{ phone: '11912345678', name: 'Ana' }]);
    expect(parseContactText('11912345678,"Ana; Silva"')).toEqual([{ phone: '11912345678', name: 'Ana; Silva' }]);
    expect(parseContactText('11912345678\n\n21912345678')).toHaveLength(2);
  });
  it('rejects malformed CSV, extra columns, empty input, oversized batches and byte limits', () => {
    for (const text of ['', 'telefone,nome', '11912345678,"unfinished', '11912345678,"Ana"oops', '1,2,3', '1\n'.repeat(501), 'é'.repeat(32769)]) expect(() => parseContactText(text)).toThrow();
  });
});

describe('contacts API and production SQL on PostgreSQL WASM', () => {
  const database = new PGlite(); let available = Promise.resolve();
  const pool = { query: async (sql: string, params?: unknown[]) => { const result = await database.query(sql, params); return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 }; }, connect: async () => {
    const previous = available; let release!: () => void;
    available = new Promise<void>((resolve) => { release = resolve; }); await previous;
    return { release, query: async (sql: string, params?: unknown[]) => { const result = await database.query(sql, params); return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 }; } };
  } } as unknown as Pool;
  const store = new PgContactStore(pool); const service = new ContactService(store);
  let alice: WorkspaceContext; let bob: WorkspaceContext;
  beforeAll(async () => {
    const directory = new URL('../../../../../packages/database/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(file, directory), 'utf-8'));
  }, 30000);
  beforeEach(async () => {
    await database.exec('TRUNCATE users, workspaces CASCADE');
    const seed = async (name: string): Promise<WorkspaceContext> => {
      const user = randomUUID(); const workspace = randomUUID();
      await database.query('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)', [user, name, `${name}@example.test`, 'unused']);
      await database.query('INSERT INTO workspaces (id,name,slug,created_by_user_id) VALUES ($1,$2,$3,$4)', [workspace, name, name, user]);
      await database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')", [workspace, user]);
      return { workspace_id: workspace, user_id: user, role: 'owner', permissions: ['contacts.manage', 'contacts.view'] };
    };
    alice = await seed('alice'); bob = await seed('bob');
  });
  afterAll(async () => { await database.close(); });
  const inputs = [{ phone: '11912345678', name: 'Ana' }, { phone: '+5511912345678', name: 'Replacement ignored' }, { phone: 'invalid' }];
  it('bounds contact pages while preserving an accurate workspace total', async () => {
    await store.import(alice, Array.from({ length: 101 }, (_, index) => ({ phone: `+551191234${String(index).padStart(4, '0')}`, name: '' })), []);
    expect((await service.snapshot(alice)).contacts).toHaveLength(100);
    expect((await service.snapshot(alice, 100)).contacts).toHaveLength(1);
    expect((await service.snapshot(alice, 100)).total).toBe(101);
    expect((await service.snapshot(bob)).total).toBe(0);
  });
  it('deduplicates within each workspace, reports invalid rows and excludes phones from audits', async () => {
    expect(await service.import(alice, inputs)).toEqual({ created: 1, duplicates: 1, optedOut: 0, invalidRows: [3] });
    expect(await service.import(bob, [inputs[0]!])).toMatchObject({ created: 1 });
    expect((await service.snapshot(alice)).contacts).toMatchObject([{ name: 'Ana', phone_normalized: '+5511912345678' }]);
    const audit = await database.query('SELECT metadata FROM audit_logs');
    expect(JSON.stringify(audit.rows)).not.toMatch(/11912345678|Ana/);
  });
  it('uses composite ownership, allows several lists and preserves contacts when a list is deleted', async () => {
    const first = await service.createList(alice, 'First'); const second = await service.createList(alice, 'Second'); const foreign = await service.createList(bob, 'Foreign');
    expect(await service.import(alice, inputs, foreign.id)).toBeNull();
    expect((await service.snapshot(alice)).total).toBe(0);
    await service.import(alice, inputs, first.id); await service.import(alice, [inputs[0]!], second.id);
    const contact = (await service.snapshot(alice)).contacts[0]!;
    await expect(database.query('INSERT INTO contact_list_members (workspace_id,list_id,contact_id) VALUES ($1,$2,$3)', [alice.workspace_id, foreign.id, contact.id])).rejects.toThrow();
    expect((await service.snapshot(alice)).lists.map((list) => list.contact_count)).toEqual([1, 1]);
    expect(await service.deleteList(bob, first.id)).toBe(false);
    expect(await service.deleteList(alice, first.id)).toBe(true);
    expect((await service.snapshot(alice)).total).toBe(1);
  });
  it('persists opt-out independently from lists and import cannot reactivate it', async () => {
    await service.import(alice, [inputs[0]!]); const contact = (await service.snapshot(alice)).contacts[0]!;
    expect(await service.setOptOut(bob, contact.id)).toBe(false);
    expect(await service.setOptOut(alice, contact.id)).toBe(true);
    expect(await service.setOptOut(alice, contact.id)).toBe(true);
    expect(await service.import(alice, [inputs[0]!])).toMatchObject({ created: 0, optedOut: 1 });
    expect((await service.snapshot(alice)).contacts[0]?.opted_out).toBe(true);
    // Future contact deletion must not erase the workspace suppression record.
    await database.query('DELETE FROM contacts WHERE workspace_id=$1 AND id=$2', [alice.workspace_id, contact.id]);
    expect(await service.import(alice, [inputs[0]!])).toMatchObject({ created: 0, optedOut: 1 });
    expect(await service.import(bob, [inputs[0]!])).toMatchObject({ created: 1 });
  });
  it('reauthorizes roles inside each transaction and allows readers only to view', async () => {
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1", [alice.workspace_id]);
    expect((await service.snapshot(alice)).total).toBe(0);
    await expect(service.import(alice, inputs)).rejects.toMatchObject({ reason: 'forbidden' });
    await expect(service.createList(alice, 'Denied')).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE workspace_members SET status='removed' WHERE workspace_id=$1", [alice.workspace_id]);
    await expect(service.snapshot(alice)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('rolls back import, list deletion and opt-out when auditing fails', async () => {
    const list = await service.createList(alice, 'Preserved'); await service.import(alice, [inputs[0]!], list.id);
    const contact = (await service.snapshot(alice)).contacts[0]!;
    await database.exec("CREATE FUNCTION reject_contacts_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_contacts_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_contacts_audit()");
    try {
      await expect(service.import(alice, [{ phone: '21912345678' }], list.id)).rejects.toThrow();
      await expect(service.deleteList(alice, list.id)).rejects.toThrow();
      await expect(service.setOptOut(alice, contact.id)).rejects.toThrow();
      const snapshot = await service.snapshot(alice);
      expect(snapshot.total).toBe(1); expect(snapshot.lists[0]?.contact_count).toBe(1); expect(snapshot.contacts[0]?.opted_out).toBe(false);
    } finally { await database.exec('DROP TRIGGER reject_contacts_audit ON audit_logs; DROP FUNCTION reject_contacts_audit()'); }
  });
  it('enforces HTTP session, CSRF, schemas and permissions through the actual app', async () => {
    const redis = { defineCommand: () => undefined, rateLimit: (_key: string, window: number, _max: number, _cont: boolean, _exp: boolean, callback: (error: null, value: number[]) => void) => callback(null, [1, window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id, name: 'Alice', email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool, redis, authStore }, { appUrl: 'http://localhost:3000', secureCookies: false });
    const headers = { origin: 'http://localhost:3000', 'x-rcs-request': '1', cookie: `rcs_session=${'a'.repeat(43)}` };
    const url = `/workspaces/${alice.workspace_id}/contacts`;
    try {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url, headers: { cookie: headers.cookie }, payload: inputs[0] })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url, headers, payload: { phone: 'invalid' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: `${url}/import`, headers, payload: { text: '11912345678', contacts: inputs } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url, headers, payload: inputs[0] })).statusCode).toBe(201);
      expect((await app.inject({ url, headers })).json().total).toBe(1);
      expect((await app.inject({ url: url.replace(alice.workspace_id, bob.workspace_id), headers })).statusCode).toBe(404);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1", [alice.workspace_id]);
      expect((await app.inject({ url, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url, headers, payload: inputs[0] })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
