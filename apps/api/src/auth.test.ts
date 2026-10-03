import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { hashPassword } from '@rcs/security';
import { createApp } from './app.js';
import { hashToken } from './modules/auth/application/auth-service.js';
import { sessionToken } from './modules/auth/presentation/security.js';
import type { AuthStore, AuthUser, LoginUser } from './modules/auth/domain/contracts.js';
import { permissions, type Role, type WorkspaceStore } from './modules/workspaces/domain/contracts.js';

const workspaceId = '61ae7915-2e7a-427c-8a7f-18a22a99e27a';
const otherWorkspaceId = 'bf371343-698f-4862-9b83-2b137f28b30a';

const password = 'test-password-long-enough';
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(password); });

function fixture(secureCookies = false, proxySecret?: string) {
  const user: LoginUser = { id: '5d58f1ae-8b82-46e2-b030-331980fbd649', name: 'Test User', email: 'owner@example.test',
    password_hash: passwordHash, status: 'active', disabled_at: null };
  const membership: { role: Role; active: boolean; workspaceActive: boolean } = { role: 'owner', active: true, workspaceActive: true };
  const sessions = new Map<string, { user: AuthUser; expires: Date; revoked: boolean }>();
  const events: string[] = [];
  const store: AuthStore = {
    register: vi.fn(async (_input, hash, expires) => {
      sessions.set(hash.toString('hex'), { user, expires, revoked: false });
      return { id: user.id, name: user.name, email: user.email };
    }),
    findUser: vi.fn(async (email) => email === user.email ? user : null),
    createSession: vi.fn(async (_user, hash, expires) => {
      sessions.set(hash.toString('hex'), { user, expires, revoked: false });
      events.push('auth.login_succeeded');
      return true;
    }),
    findSession: vi.fn(async (hash) => {
      const session = sessions.get(hash.toString('hex'));
      return session && !session.revoked && session.expires > new Date() && !user.disabled_at && user.status === 'active'
        ? { id: user.id, name: user.name, email: user.email } : null;
    }),
    revokeSession: vi.fn(async (hash) => { sessions.get(hash.toString('hex'))!.revoked = true; events.push('auth.logout'); }),
    failedLogin: vi.fn(async () => { events.push('auth.login_failed'); })
  };
  const workspaceStore: WorkspaceStore = {
    listForUser: vi.fn(async () => [{ id: workspaceId, name: 'Test', slug: 'test', status: 'active', role: membership.role }]),
    resolveContext: vi.fn(async (userId, id) => id === workspaceId && membership.active && membership.workspaceActive
      ? { user_id: userId, workspace_id: id, role: membership.role, permissions: permissions[membership.role] } : null),
    listAudit: vi.fn(async () => []), listMembers: vi.fn(async () => []),
    inviteMember: vi.fn(async () => 'ok' as const), changeMember: vi.fn(async () => 'ok' as const)
  };
  const counts = new Map<string, number>();
  const redis = {
    defineCommand: () => undefined,
    rateLimit: (key: string, window: number, _max: number, _continue: boolean, _exponential: boolean,
      callback: (error: Error | null, result?: number[]) => void) => {
      const current = (counts.get(key) ?? 0) + 1;
      counts.set(key, current);
      callback(null, [current, window]);
    },
    ping: async () => 'PONG'
  } as unknown as Redis;
  const app = createApp({ db: {} as Pool, redis, authStore: store, workspaceStore }, {
    appUrl: secureCookies ? 'https://app.example.test' : 'http://localhost:3000', secureCookies, proxySecret
  });
  const headers = { origin: secureCookies ? 'https://app.example.test' : 'http://localhost:3000', 'x-rcs-request': '1' };
  const login = () => app.inject({ method: 'POST', url: '/auth/login', headers, payload: { email: user.email, password } });
  return { app, user, store, workspaceStore, membership, redis, sessions, events, headers, login };
}

describe('authentication and authorization', () => {
  it('keeps client rate limits separate and rejects spoofed or untrusted proxy headers', async () => {
    const proxySecret = 'b'.repeat(64);
    const f = fixture(false, proxySecret);
    const attempt = (ip: string, token = proxySecret, remoteAddress = '127.0.0.1') => f.app.inject({
      method: 'POST', url: '/auth/login', remoteAddress,
      headers: { ...f.headers, 'x-forwarded-for': ip, 'x-rcs-proxy-token': token },
      payload: { email: f.user.email, password: 'wrong' }
    });
    try {
      for (const [ip, token, peer] of [['192.0.2.10', '', '127.0.0.1'], ['192.0.2.10', 'a'.repeat(64), '127.0.0.1'],
        ['192.0.2.10, 192.0.2.11', proxySecret, '127.0.0.1'], ['192.0.2.10', proxySecret, '203.0.113.5']]) {
        expect((await attempt(ip!, token!, peer!)).statusCode).toBe(403);
      }
      expect(f.store.findUser).not.toHaveBeenCalled();
      for (let i = 0; i < 5; i++) expect((await attempt('192.0.2.10')).statusCode).toBe(401);
      expect((await attempt('192.0.2.10')).statusCode).toBe(429);
      expect((await attempt('192.0.2.11')).statusCode).toBe(401);
      for (let i = 0; i < 5; i++) expect((await attempt(`2001:db8::${i + 1}`)).statusCode).toBe(401);
      expect((await attempt('2001:db8::99')).statusCode).toBe(429);
    } finally { await f.app.close(); }
  });

  it('issues an opaque HttpOnly cookie, persists only its hash, and revokes it on logout', async () => {
    const f = fixture();
    try {
      const response = await f.login();
      expect(response.statusCode).toBe(200);
      expect(response.json().user).toEqual({ id: f.user.id, name: f.user.name, email: f.user.email });
      expect(response.headers['cache-control']).toBe('no-store');
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly; SameSite=Strict; Max-Age=28800');
      const token = sessionToken(cookie, 'rcs_session')!;
      expect(token).toHaveLength(43);
      expect(f.sessions.has(hashToken(token).toString('hex'))).toBe(true);
      expect((await f.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(200);
      const logout = await f.app.inject({ method: 'POST', url: '/auth/logout', headers: { ...f.headers, cookie } });
      expect(logout.statusCode).toBe(204);
      expect(logout.headers['set-cookie']).toContain('Max-Age=0');
      expect((await f.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
      expect(f.events).toEqual(['auth.login_succeeded', 'auth.logout']);
    } finally { await f.app.close(); }
  });

  it('rejects anonymous, forged, duplicate, expired and disabled sessions', async () => {
    const f = fixture();
    try {
      expect((await f.app.inject('/auth/me')).statusCode).toBe(401);
      expect((await f.app.inject({ url: '/auth/me', headers: { cookie: `rcs_session=${'a'.repeat(43)}` } })).statusCode).toBe(401);
      const cookie = String((await f.login()).headers['set-cookie']);
      const pair = cookie.split(';')[0];
      expect((await f.app.inject({ url: '/auth/me', headers: { cookie: `${pair}; ${pair}` } })).statusCode).toBe(401);
      f.sessions.values().next().value!.expires = new Date(0);
      expect((await f.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
      f.sessions.values().next().value!.expires = new Date(Date.now() + 10000);
      f.user.disabled_at = new Date();
      expect((await f.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });

  it('uses workspace permissions, gives audit access only to owner, and denies routes without permission', async () => {
    const f = fixture();
    f.app.get('/future-module', async () => ({ ok: true }));
    try {
      const cookie = String((await f.login()).headers['set-cookie']);
      expect((await f.app.inject({ url: `/workspaces/${workspaceId}/audit`, headers: { cookie } })).statusCode).toBe(200);
      f.membership.role = 'admin';
      expect((await f.app.inject({ url: `/workspaces/${workspaceId}/audit`, headers: { cookie } })).statusCode).toBe(403);
      f.membership.role = 'viewer';
      expect((await f.app.inject({ url: '/auth/me', headers: { cookie } })).statusCode).toBe(200);
      expect((await f.app.inject({ url: `/workspaces/${workspaceId}/audit`, headers: { cookie } })).statusCode).toBe(403);
      expect((await f.app.inject({ url: '/future-module', headers: { cookie } })).statusCode).toBe(403);
    } finally { await f.app.close(); }
  });

  it('rejects foreign, inactive and suspended workspaces before calling scoped repositories', async () => {
    const f = fixture();
    try {
      const cookie = String((await f.login()).headers['set-cookie']);
      const headers = { ...f.headers, cookie };
      expect((await f.app.inject({ url: `/workspaces/${otherWorkspaceId}/audit`, headers })).statusCode).toBe(404);
      expect((await f.app.inject({ method: 'POST', url: `/workspaces/${otherWorkspaceId}/members`, headers,
        payload: { email: 'other@example.test', role: 'owner' } })).statusCode).toBe(404);
      expect(f.workspaceStore.listAudit).not.toHaveBeenCalled();
      expect(f.workspaceStore.inviteMember).not.toHaveBeenCalled();
      f.membership.active = false;
      expect((await f.app.inject({ url: `/workspaces/${workspaceId}/context`, headers })).statusCode).toBe(404);
      f.membership.active = true;
      f.membership.workspaceActive = false;
      expect((await f.app.inject({ url: `/workspaces/${workspaceId}/context`, headers })).statusCode).toBe(404);
    } finally { await f.app.close(); }
  });

  it('registers with a hashed password and rejects client-supplied role or workspace id', async () => {
    const f = fixture();
    try {
      const payload = { name: 'New User', email: 'new@example.test', password, workspaceName: 'My Workspace' };
      const response = await f.app.inject({ method: 'POST', url: '/auth/register', headers: f.headers, payload });
      expect(response.statusCode).toBe(201);
      expect(response.headers['set-cookie']).toContain('HttpOnly');
      expect(vi.mocked(f.store.register).mock.calls[0]![0]).toMatchObject({ name: 'New User', email: 'new@example.test', workspaceName: 'My Workspace' });
      expect(vi.mocked(f.store.register).mock.calls[0]![0].passwordHash).not.toContain(password);
      for (const extra of [{ role: 'owner' }, { workspace_id: otherWorkspaceId }]) {
        expect((await f.app.inject({ method: 'POST', url: '/auth/register', headers: f.headers, payload: { ...payload, ...extra } })).statusCode).toBe(400);
      }
      expect(f.store.register).toHaveBeenCalledTimes(1);
    } finally { await f.app.close(); }
  });

  it('requires a valid origin and custom header for PATCH and DELETE', async () => {
    const f = fixture();
    try {
      const cookie = String((await f.login()).headers['set-cookie']);
      for (const method of ['PATCH', 'DELETE'] as const) {
        const response = await f.app.inject({ method, url: `/workspaces/${workspaceId}/members/${f.user.id}`,
          headers: { cookie, origin: 'https://evil.example' }, ...(method === 'PATCH' ? { payload: { role: 'viewer' } } : {}) });
        expect(response.statusCode).toBe(403);
      }
      expect(f.workspaceStore.changeMember).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });

  it('blocks cross-origin, missing-origin and missing-header mutations including login CSRF', async () => {
    const f = fixture();
    try {
      for (const headers of [{ origin: 'https://evil.example', 'x-rcs-request': '1' }, {},
        { origin: 'http://localhost:3000' }, { origin: 'http://localhost:3000.evil.test', 'x-rcs-request': '1' }]) {
        const response = await f.app.inject({ method: 'POST', url: '/auth/login', headers,
          payload: { email: f.user.email, password } });
        expect(response.statusCode).toBe(403);
      }
      expect(f.store.findUser).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });

  it('uses indistinguishable errors for incorrect, unknown and disabled accounts', async () => {
    const f = fixture();
    try {
      const wrong = await f.app.inject({ method: 'POST', url: '/auth/login', headers: f.headers,
        payload: { email: f.user.email, password: 'wrong' } });
      const unknown = await f.app.inject({ method: 'POST', url: '/auth/login', headers: f.headers,
        payload: { email: 'missing@example.test', password } });
      f.user.disabled_at = new Date();
      const disabled = await f.login();
      for (const response of [wrong, unknown, disabled]) {
        expect(response.statusCode).toBe(401);
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(response.json()).toEqual({ message: 'E-mail ou senha inválidos.' });
      }
      expect(f.events).toEqual(['auth.login_failed', 'auth.login_failed', 'auth.login_failed']);
    } finally { await f.app.close(); }
  });

  it('rejects malformed payloads and limits login attempts', async () => {
    const f = fixture();
    try {
      const malformed = await f.app.inject({ method: 'POST', url: '/auth/login', headers: f.headers,
        payload: { email: 'invalid', password, role: 'admin' } });
      expect(malformed.statusCode).toBe(400);
      expect(f.store.findUser).not.toHaveBeenCalled();
      for (let i = 0; i < 4; i++) {
        await f.app.inject({ method: 'POST', url: '/auth/login', headers: f.headers,
          payload: { email: f.user.email, password: 'wrong' } });
      }
      expect((await f.login()).statusCode).toBe(429);
    } finally { await f.app.close(); }
  });

  it('sets the production __Host cookie and fails closed on storage errors without revealing them', async () => {
    const f = fixture(true);
    try {
      expect((await f.login()).headers['set-cookie']).toMatch(/^__Host-rcs_session=.*; Secure$/);
      vi.mocked(f.store.findUser).mockRejectedValue(new Error('database-password-secret'));
      const response = await f.login();
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('database-password-secret');
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally { await f.app.close(); }
  });

  it('fails closed when the Redis rate-limit store is unavailable', async () => {
    const f = fixture();
    f.redis.defineCommand = () => undefined;
    (f.redis as unknown as { rateLimit: (...args: unknown[]) => void }).rateLimit = (...args) => {
      (args.at(-1) as (error: Error) => void)(new Error('Redis unavailable'));
    };
    try {
      const response = await f.login();
      expect(response.statusCode).toBe(503);
      expect(f.store.findUser).not.toHaveBeenCalled();
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally { await f.app.close(); }
  });
});
