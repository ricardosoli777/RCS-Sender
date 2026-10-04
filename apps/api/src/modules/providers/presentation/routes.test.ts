import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthStore } from '../../auth/domain/contracts.js';
import { registerSecurity } from '../../auth/presentation/security.js';
import { permissions, type Role, type WorkspaceStore } from '../../workspaces/domain/contracts.js';
import type { ProviderService } from '../application/provider-service.js';
import { registerProviderRoutes } from './routes.js';

const id = '61ae7915-2e7a-427c-8a7f-18a22a99e27a';
function fixture() {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  let role: Role = 'owner';
  const auth = { findSession: async () => ({ id, name: 'Owner', email: 'owner@example.test' }) } as unknown as AuthStore;
  const workspaces = { resolveContext: async (_user: string, workspace: string) => workspace === id
    ? { user_id: id, workspace_id: id, role, permissions: permissions[role] } : null } as WorkspaceStore;
  registerSecurity(app, auth, workspaces, { appUrl: 'http://localhost:3000', secureCookies: false });
  const testConnection = vi.fn(async () => ({ status: 'connected' }));
  registerProviderRoutes(app, { testConnection } as unknown as ProviderService);
  const headers = { origin: 'http://localhost:3000', 'x-rcs-request': '1', cookie: `rcs_session=${'a'.repeat(43)}` };
  const url = `/workspaces/${id}/providers/${id}/test`;
  return { app, testConnection, headers, url, setRole: (value: Role) => { role = value; } };
}

describe('connection test HTTP boundary', () => {
  it('requires session, CSRF and current workspace management permission before executing', async () => {
    const f = fixture();
    try {
      expect((await f.app.inject({ method: 'POST', url: f.url, headers: { origin: f.headers.origin, 'x-rcs-request': '1' }, payload: {} })).statusCode).toBe(401);
      expect((await f.app.inject({ method: 'POST', url: f.url, headers: { cookie: f.headers.cookie }, payload: {} })).statusCode).toBe(403);
      f.setRole('viewer');
      expect((await f.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: {} })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'POST', url: f.url.replace(id, '00000000-0000-0000-0000-000000000000'), headers: f.headers, payload: {} })).statusCode).toBe(404);
      expect(f.testConnection).not.toHaveBeenCalled();
      f.setRole('admin');
      const response = await f.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: {} });
      expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ status: 'connected' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(f.testConnection).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: id, role: 'admin' }), id, expect.any(AbortSignal));
    } finally { await f.app.close(); }
  });
  it('rejects injected credentials, malformed ids and excessive bodies before executing', async () => {
    const f = fixture();
    try {
      expect((await f.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: { credentials: { apiKey: 'injected' } } })).statusCode).toBe(400);
      expect((await f.app.inject({ method: 'POST', url: f.url.replace(`/providers/${id}`, '/providers/invalid'), headers: f.headers, payload: {} })).statusCode).toBe(400);
      expect((await f.app.inject({ method: 'POST', url: f.url, headers: { ...f.headers, 'content-type': 'application/json' }, payload: ' '.repeat(1025) })).statusCode).toBe(413);
      expect(f.testConnection).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
});
