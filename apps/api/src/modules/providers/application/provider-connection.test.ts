import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockRcsProvider, ProviderRegistry, activationChecks, canonicalError, type ProviderEvidence } from '@rcs/providers';
import { ProviderService } from './provider-service.js';
import type { LoadedProviderConnection, ProviderStore } from '../domain/contracts.js';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';

const context: WorkspaceContext = { workspace_id: 'workspace', user_id: 'owner', role: 'owner', permissions: ['providers.manage'] };
const credentials = { webhookSecret: 'synthetic-webhook-secret-at-least-32-characters' };
const evidence: ProviderEvidence = { documentPath: 'docs/providers/mock.md', reviewedAt: '2026-10-03', references: ['https://example.test/local-fixture'],
  checks: Object.fromEntries(activationChecks.map((check) => [check, true])) as ProviderEvidence['checks'] };
afterEach(() => vi.restoreAllMocks());
function setup(bound = false) {
  const adapter = Object.assign(new MockRcsProvider(), bound ? { getExternalAgentId: () => 'signed-agent' } : {});
  const registry = new ProviderRegistry(); registry.register(adapter, evidence);
  const loaded: LoadedProviderConnection = { connection: { id: 'connection', workspace_id: context.workspace_id, provider_id: 'mock', name: 'Test',
    environment: 'test', external_agent_id: bound ? 'signed-agent' : null, status: 'unverified', created_at: new Date(), updated_at: new Date() }, credentials, credentialVersion: 'opaque-version' };
  const store = { create: vi.fn(async () => loaded.connection), list: vi.fn(async () => [loaded.connection]),
    loadForProvider: vi.fn(async (): Promise<LoadedProviderConnection | null> => loaded),
    updateCredentials: vi.fn(async () => true), recordConnectionTest: vi.fn(async () => true) } satisfies ProviderStore;
  return { service: new ProviderService(registry, store), store, loaded, adapter, registry };
}
describe('provider agent ownership and connection verification', () => {
  it('derives identity on the server and discards an injected body identity', async () => {
    const { service, store } = setup(true);
    const input = { providerId: 'mock', name: 'Test', environment: 'test', credentials, externalAgentId: 'forged' };
    await service.create(context, input);
    expect(store.create).toHaveBeenCalledWith(context, { ...input, externalAgentId: 'signed-agent' });
  });
  it('allows rotation for the same identity and blocks agent reassignment', async () => {
    const { service, store, loaded } = setup(true);
    await service.updateCredentials(context, 'connection', credentials);
    expect(store.updateCredentials).toHaveBeenCalledWith(context, 'connection', credentials, 'signed-agent');
    loaded.connection.external_agent_id = 'other-agent'; store.updateCredentials.mockClear();
    await expect(service.updateCredentials(context, 'connection', credentials)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(store.updateCredentials).not.toHaveBeenCalled();
  });
  it('loads secrets internally and returns only the persisted safe status', async () => {
    const { service, store } = setup(true);
    const result = await service.testConnection(context, 'connection', new AbortController().signal);
    expect(result).toEqual({ status: 'connected' });
    expect(store.recordConnectionTest).toHaveBeenCalledWith(context, 'connection', 'opaque-version', 'connected');
    expect(JSON.stringify(result)).not.toMatch(/opaque-version|webhookSecret|synthetic-webhook/);
  });
  it('rejects missing, disabled, inactive and unbound connections before invoking the adapter', async () => {
    const { service, store, loaded, adapter } = setup(true); const run = vi.spyOn(adapter, 'testConnection');
    store.loadForProvider.mockResolvedValueOnce(null);
    await expect(service.testConnection(context, 'connection', new AbortController().signal)).rejects.toMatchObject({ reason: 'not_found' });
    loaded.connection.status = 'disabled';
    await expect(service.testConnection(context, 'connection', new AbortController().signal)).rejects.toMatchObject({ reason: 'unavailable' });
    loaded.connection.status = 'unverified'; loaded.connection.external_agent_id = null;
    await expect(service.testConnection(context, 'connection', new AbortController().signal)).rejects.toMatchObject({ reason: 'unavailable' });
    loaded.connection.external_agent_id = 'signed-agent'; loaded.connection.provider_id = 'inactive';
    await expect(service.testConnection(context, 'connection', new AbortController().signal)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(run).not.toHaveBeenCalled(); expect(store.recordConnectionTest).not.toHaveBeenCalled();
  });
  it('normalizes raw adapter errors and records failure with a fixed error message', async () => {
    const { service, store, adapter } = setup();
    vi.spyOn(adapter, 'testConnection').mockRejectedValueOnce(new Error('raw-private-key-secret'));
    expect(await service.testConnection(context, 'connection', new AbortController().signal)).toEqual({ status: 'disconnected', error: canonicalError('unavailable') });
    expect(store.recordConnectionTest).toHaveBeenCalledWith(context, 'connection', 'opaque-version', 'disconnected');
    vi.spyOn(adapter, 'testConnection').mockResolvedValueOnce({ status: 'disconnected', error: { code: 'rejected', message: 'raw-secret', retryable: true } });
    expect(await service.testConnection(context, 'connection', new AbortController().signal)).toEqual({ status: 'disconnected', error: canonicalError('rejected') });
  });
  it('does not return success when the credential snapshot became stale or authorization was revoked', async () => {
    const { service, store } = setup();
    store.recordConnectionTest.mockResolvedValueOnce(false);
    await expect(service.testConnection(context, 'connection', new AbortController().signal)).rejects.toMatchObject({ reason: 'unavailable' });
    store.recordConnectionTest.mockRejectedValueOnce(Object.assign(new Error('revoked'), { reason: 'forbidden' }));
    await expect(service.testConnection(context, 'connection', new AbortController().signal)).rejects.toMatchObject({ reason: 'forbidden' });
  });
  it('cancels an uncooperative adapter without persisting an abandoned request', async () => {
    const { service, store, adapter } = setup(); const controller = new AbortController();
    vi.spyOn(adapter, 'testConnection').mockImplementation(async () => { controller.abort(); return new Promise(() => undefined); });
    await expect(service.testConnection(context, 'connection', controller.signal)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(store.recordConnectionTest).not.toHaveBeenCalled();
  });
  it('records timeout failure and never starts a call for an already cancelled request', async () => {
    const { service, store, adapter } = setup(); const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const run = vi.spyOn(adapter, 'testConnection').mockImplementation(async () => { timeout.abort(); return new Promise(() => undefined); });
    expect(await service.testConnection(context, 'connection', new AbortController().signal)).toEqual({ status: 'disconnected', error: canonicalError('unavailable') });
    expect(store.recordConnectionTest).toHaveBeenCalledOnce(); run.mockClear(); store.recordConnectionTest.mockClear();
    const abandoned = new AbortController(); abandoned.abort();
    await expect(service.testConnection(context, 'connection', abandoned.signal)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(run).not.toHaveBeenCalled(); expect(store.recordConnectionTest).not.toHaveBeenCalled();
  });
});
