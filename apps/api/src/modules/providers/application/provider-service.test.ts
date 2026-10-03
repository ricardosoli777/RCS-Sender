import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry, activationChecks, capabilityMatrix, type RcsProvider, type ProviderEvidence } from '@rcs/providers';
import { ProviderService } from './provider-service.js';
import type { PgProviderStore } from '../infrastructure/pg-provider-store.js';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';
const context: WorkspaceContext = { workspace_id: 'workspace', user_id: 'user', role: 'owner', permissions: ['providers.manage'] };
const evidence: ProviderEvidence = { documentPath: 'docs/providers/test-fixture.md', reviewedAt: '2026-10-03', references: ['https://example.test/local-fixture'], checks: Object.fromEntries(activationChecks.map((key) => [key, true])) as ProviderEvidence['checks'] };
function setup() {
  const unsupported = async () => { throw new Error('Local fixture only'); };
  const validateCredentials = vi.fn(() => true);
  const adapter: RcsProvider = { getProviderMetadata: () => ({ id: 'test_fixture', name: 'Local fixture', environments: ['test'], credentialSchema: [{ key: 'apiKey', label: 'Test key', required: true, secret: true }] }),
    getProviderCapabilities: () => capabilityMatrix(), getProviderLimits: () => ({}), validateCredentials,
    testConnection: unsupported, getConnectionStatus: unsupported, listAgents: unsupported, getAgent: unsupported, getAgentCapabilities: unsupported,
    send: unsupported, verifyWebhook: unsupported, parseWebhook: unsupported, normalizeEvent: () => null, getHealth: unsupported };
  const registry = new ProviderRegistry(); registry.register(adapter, evidence);
  const create = vi.fn(async () => ({ id: 'connection', status: 'unverified' }));
  const service = new ProviderService(registry, { create } as unknown as PgProviderStore);
  return { service, create, validateCredentials };
}
describe('provider service credential boundary', () => {
  it('rejects unknown providers, environments, missing required credentials and extra credential keys before persistence', () => {
    const { service, create } = setup();
    const valid = { providerId: 'test_fixture', environment: 'test', name: 'Local fixture', credentials: { apiKey: 'test-secret' } };
    const inputs: Parameters<ProviderService['create']>[1][] = [{ ...valid, providerId: 'missing' }, { ...valid, environment: 'production' }, { ...valid, credentials: {} }, { ...valid, credentials: { apiKey: 'test-secret', extra: 'not-allowed' } }];
    for (const input of inputs) {
      expect(() => service.create(context, input)).toThrow();
    }
    expect(create).not.toHaveBeenCalled();
  });
  it('hides adapter exceptions and persists only validated connections without network calls', async () => {
    const { service, create, validateCredentials } = setup();
    const input = { providerId: 'test_fixture', environment: 'test', name: 'Local fixture', credentials: { apiKey: 'test-secret' } };
    validateCredentials.mockImplementationOnce(() => { throw new Error('test-secret-provider-error'); });
    expect(() => service.create(context, input)).toThrow('Provider operation rejected');
    expect(create).not.toHaveBeenCalled();
    expect(await service.create(context, input)).toMatchObject({ status: 'unverified' });
    expect(create).toHaveBeenCalledWith(context, input);
  });
});
