import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockRcsProvider, ProviderRegistry, activationChecks, type ProviderEvidence, type ProviderContext } from '@rcs/providers';
import type { ProviderStore, LoadedProviderConnection } from '../providers/domain/contracts.js';
import type { EligibilityStore } from './contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { EligibilityService } from './service.js';

const context: WorkspaceContext = { user_id: 'owner',workspace_id: 'workspace',role: 'owner',permissions: ['providers.manage'] };
afterEach(() => vi.restoreAllMocks());
function fixture(capability: 'supported' | 'unsupported' | 'unknown' = 'supported', active = true) {
  const mock = new MockRcsProvider();
  const checkEligibility = vi.fn(async (_context: ProviderContext, recipient: string): Promise<boolean | null> => recipient === '+5511912345678');
  const send = vi.spyOn(mock,'send');
  const adapter = Object.assign(mock, { getProviderCapabilities: () => ({ ...new MockRcsProvider().getProviderCapabilities(),eligibility: capability }), checkEligibility });
  const evidence: ProviderEvidence = { documentPath: 'docs/providers/mock.md', reviewedAt: '2026-10-03',references: ['https://example.test/local-fixture'],
    checks: Object.fromEntries(activationChecks.map((key) => [key,active])) as ProviderEvidence['checks'] };
  const registry = new ProviderRegistry(); registry.register(adapter,evidence);
  const loaded: LoadedProviderConnection = { connection: { id: 'connection',workspace_id: 'workspace',provider_id: 'mock',name: 'Fixture',environment: 'test',status: 'connected',external_agent_id: null,created_at: new Date(),updated_at: new Date() },
    credentials: { webhookSecret: 'synthetic-webhook-secret-at-least-32-characters' },credentialVersion: 'version' };
  const providers = { loadForProvider: vi.fn(async (): Promise<LoadedProviderConnection | null> => loaded) } as unknown as ProviderStore;
  const contact = { id: 'contact',phone: '+5511912345678',optedOut: false };
  const store = { contact: vi.fn<EligibilityStore['contact']>(async () => contact),begin: vi.fn<EligibilityStore['begin']>(async () => 'attempt'),save: vi.fn<EligibilityStore['save']>(async (_context, _connection, _contact, _version, _attempt, result) => ({ ...result,checkedAt: new Date(),expiresAt: new Date(Date.now()+300000) })) } satisfies EligibilityStore;
  return { service: new EligibilityService(registry,providers,store),store,loaded,contact,checkEligibility,send,adapter,providers };
}
describe('provider-independent eligibility', () => {
  it.each([[true,'eligible'],[false,'ineligible'],[null,'unknown']] as const)('maps %s to %s without sending or exposing secrets', async (value,status) => {
    const f = fixture(); f.checkEligibility.mockResolvedValue(value);
    const result = await f.service.check(context,'connection','contact',new AbortController().signal);
    expect(result.status).toBe(status); expect(f.checkEligibility).toHaveBeenCalledOnce(); expect(f.send).not.toHaveBeenCalled();
    expect(f.store.begin).toHaveBeenCalledWith(context,'connection','contact','version','+5511912345678');
    expect(JSON.stringify(result)).not.toMatch(/webhookSecret|synthetic|credentialVersion|5511912345678/);
    expect(f.store.save).toHaveBeenCalledWith(context,'connection','contact','version','attempt',expect.objectContaining({ status }));
  });
  it.each(['unsupported','unknown'] as const)('does not invoke the adapter for %s eligibility', async (capability) => {
    const f = fixture(capability);
    expect(await f.service.check(context,'connection','contact',new AbortController().signal)).toMatchObject({ status: 'unknown',reason: 'unsupported' });
    expect(f.checkEligibility).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('blocks opted-out contacts and disconnected/inactive providers without calling the adapter', async () => {
    const f = fixture(); f.contact.optedOut = true;
    expect(await f.service.check(context,'connection','contact',new AbortController().signal)).toMatchObject({ status: 'blocked',reason: 'opted_out' });
    f.contact.optedOut = false; f.loaded.connection.status = 'unverified';
    expect(await f.service.check(context,'connection','contact',new AbortController().signal)).toMatchObject({ status: 'unknown',reason: 'connection_unavailable' });
    const inactive = fixture('supported',false);
    expect(await inactive.service.check(context,'connection','contact',new AbortController().signal)).toMatchObject({ status: 'unknown',reason: 'provider_unavailable' });
    expect(f.checkEligibility).not.toHaveBeenCalled(); expect(inactive.checkEligibility).not.toHaveBeenCalled();
  });
  it('sanitizes failures and checks the signed agent binding before querying', async () => {
    const f = fixture(); f.checkEligibility.mockRejectedValue(new Error('token=private-key-details'));
    expect(await f.service.check(context,'connection','contact',new AbortController().signal)).toMatchObject({ status: 'unknown',reason: 'provider_unavailable' });
    f.checkEligibility.mockClear();
    Object.assign(f.adapter,{ getExternalAgentId: () => 'different-agent' });
    expect(await f.service.check(context,'connection','contact',new AbortController().signal)).toMatchObject({ status: 'unknown',reason: 'provider_unavailable' });
    expect(f.checkEligibility).not.toHaveBeenCalled();
  });
  it('rejects stale reservations/results and revoked permissions', async () => {
    const f = fixture(); f.store.begin.mockResolvedValueOnce(null);
    await expect(f.service.check(context,'connection','contact',new AbortController().signal)).rejects.toMatchObject({ reason: 'stale' });
    expect(f.checkEligibility).not.toHaveBeenCalled();
    f.store.save.mockResolvedValueOnce(null);
    await expect(f.service.check(context,'connection','contact',new AbortController().signal)).rejects.toMatchObject({ reason: 'stale' });
    f.store.begin.mockRejectedValueOnce(Object.assign(new Error('Role revoked'),{ reason: 'forbidden' }));
    await expect(f.service.check(context,'connection','contact',new AbortController().signal)).rejects.toMatchObject({ reason: 'forbidden' });
  });
  it('abandons an uncooperative provider on client cancellation and does not finalize', async () => {
    const f = fixture(); const controller = new AbortController(); let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    f.checkEligibility.mockImplementation(() => { entered(); return new Promise(() => undefined); });
    const pending = f.service.check(context,'connection','contact',controller.signal); await started; controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'stale' }); expect(f.store.save).not.toHaveBeenCalled();
  });
  it('persists unknown on provider deadline and does not query an already cancelled request', async () => {
    const f = fixture(); const timeout = new AbortController(); vi.spyOn(AbortSignal,'timeout').mockReturnValue(timeout.signal);
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    f.checkEligibility.mockImplementation(() => { entered(); return new Promise(() => undefined); });
    const pending = f.service.check(context,'connection','contact',new AbortController().signal); await started; timeout.abort();
    expect(await pending).toMatchObject({ status: 'unknown',reason: 'provider_unavailable' });
    f.store.begin.mockClear(); f.checkEligibility.mockClear();
    await expect(f.service.check(context,'connection','contact',AbortSignal.abort())).rejects.toMatchObject({ reason: 'stale' });
    expect(f.store.begin).not.toHaveBeenCalled(); expect(f.checkEligibility).not.toHaveBeenCalled();
  });
});
