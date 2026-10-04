import Fastify from 'fastify';
import { describe,expect,it } from 'vitest';
import type { ProviderRegistry } from '@rcs/providers';
import type { AuthStore } from '../auth/domain/contracts.js';
import { registerSecurity } from '../auth/presentation/security.js';
import { permissions,type WorkspaceStore } from '../workspaces/domain/contracts.js';
import { registerMessageRoutes } from './routes.js';
import type { MessageService } from './service.js';
describe('builder provider comparison boundary',() => {
  it('allows workspace readers only and exposes no credentials or evidence',async () => {
    const app = Fastify(); const id = '61ae7915-2e7a-427c-8a7f-18a22a99e27a';
    const auth = { findSession: async () => ({ id,name: 'Reader',email: 'reader@example.test' }) } as unknown as AuthStore;
    const workspaces = { resolveContext: async (_user: string,workspace: string) => workspace === id ? { user_id: id,workspace_id: id,role: 'viewer',permissions: permissions.viewer } : null } as WorkspaceStore;
    registerSecurity(app,auth,workspaces,{ appUrl: 'http://localhost:3000',secureCookies: false });
    const registry = { list: () => [{ metadata: { id: 'fixture',name: 'Fixture',credentialSchema: ['secret'] },capabilities: { text: 'unknown' },limits: {},active: false,evidence: { documentPath: 'private-path' } }] } as unknown as ProviderRegistry;
    registerMessageRoutes(app,{} as MessageService,registry);
    const headers = { cookie: `rcs_session=${'a'.repeat(43)}` }; const url = `/workspaces/${id}/messages/provider-options`;
    try {
      expect((await app.inject({ url })).statusCode).toBe(401);
      const response = await app.inject({ url,headers }); expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ providers: [{ id: 'fixture',name: 'Fixture',capabilities: { text: 'unknown' },limits: {},active: false }] });
      expect(response.headers['cache-control']).toBe('no-store'); expect(response.body).not.toMatch(/secret|private-path|credentialSchema/);
      expect((await app.inject({ url: url.replace(id,'00000000-0000-0000-0000-000000000000'),headers })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
