import { describe, expect, it } from 'vitest';
import { ProviderRegistry, activationChecks, capabilityMatrix, validateMessage, canonicalError, type RcsProvider, type ProviderEvidence } from './index.js';

// A local registry fixture; it has no network implementation or external-provider evidence.
function fixture(): RcsProvider {
  const unsupported = async () => { throw new Error('Fixture does not implement network operations'); };
  return {
    getProviderMetadata: () => ({ id: 'test_fixture', name: 'Local test fixture', environments: ['test'], credentialSchema: [{ key: 'apiKey', label: 'Test key', required: true, secret: true }] }),
    getProviderCapabilities: () => capabilityMatrix({ text: 'supported' }), getProviderLimits: () => ({ maxTextCharacters: 10 }),
    validateCredentials: (value) => typeof value.apiKey === 'string', testConnection: unsupported, getConnectionStatus: unsupported,
    listAgents: unsupported, getAgent: unsupported, getAgentCapabilities: unsupported, send: unsupported,
    verifyWebhook: unsupported, parseWebhook: unsupported, normalizeEvent: () => null, getHealth: unsupported
  };
}
const evidence: ProviderEvidence = { documentPath: 'docs/providers/test-fixture.md', reviewedAt: '2026-10-03', references: ['https://example.test/local-fixture'],
  checks: Object.fromEntries(activationChecks.map((key) => [key, true])) as ProviderEvidence['checks'] };
describe('provider core', () => {
  it('blocks adapters until every activation check and evidence requirement passes', () => {
    for (const check of activationChecks) {
      const registry = new ProviderRegistry();
      registry.register(fixture(), { ...evidence, checks: { ...evidence.checks, [check]: false } });
      expect(registry.describe('test_fixture')?.active).toBe(false);
      expect(() => registry.resolve('test_fixture')).toThrow('Provedor indisponível');
    }
    const registry = new ProviderRegistry();
    registry.register(fixture(), { ...evidence, references: [] });
    expect(() => registry.resolve('test_fixture')).toThrow();
  });
  it('resolves verified adapters, rejects duplicates and protects descriptor snapshots', () => {
    const adapter = fixture(); const registry = new ProviderRegistry();
    registry.register(adapter, evidence);
    expect(registry.resolve('test_fixture')).toBe(adapter);
    expect(() => registry.register(adapter, evidence)).toThrow();
    expect(() => registry.resolve('missing')).toThrow();
    const snapshot = registry.list()[0]!;
    (snapshot.metadata as { name: string }).name = 'Changed';
    expect(registry.describe('test_fixture')?.metadata.name).toBe('Local test fixture');
    const missingMethod = fixture(); missingMethod.getProviderCapabilities = () => capabilityMatrix({ revoke: 'supported' });
    expect(() => new ProviderRegistry().register(missingMethod, evidence)).toThrow('Capacidade sem implementação');
  });
  it('rejects unknown capabilities and checks Unicode text limits before sending', () => {
    expect(validateMessage({ type: 'text', text: 'Hello' }, capabilityMatrix(), {})).toContain('unsupported_capability');
    const matrix = capabilityMatrix({ text: 'supported' });
    expect(validateMessage({ type: 'text', text: '😀😀' }, matrix, { maxTextCharacters: 2 })).toEqual([]);
    expect(validateMessage({ type: 'text', text: '😀😀😀' }, matrix, { maxTextCharacters: 2 })).toContain('text_limit');
    expect(validateMessage({ type: 'text', text: '   ' }, matrix, {})).toContain('empty_text');
  });
  it('checks cards, media and suggestions without assuming provider support', () => {
    const matrix = capabilityMatrix({ rich_card: 'supported', url_actions: 'supported' });
    expect(validateMessage({ type: 'rich_card', card: { title: 'Title', body: 'Body', media: { assetId: 'asset', mimeType: 'image/png' } },
      suggestions: [{ type: 'open_url', text: 'Open', url: 'javascript:alert(1)' }] }, matrix, {})).toEqual(expect.arrayContaining(['unsupported_media', 'invalid_url']));
    expect(validateMessage({ type: 'carousel', cards: [] }, capabilityMatrix({ carousel: 'supported' }), {})).toContain('card_limit');
    expect(validateMessage({ type: 'text', text: 'Hello', suggestions: [{ type: 'reply', text: 'Yes', payload: 'yes' }] }, capabilityMatrix({ text: 'supported' }), {})).toContain('unsupported_capability');
  });
  it('exposes fixed safe errors and retries only explicitly transient failures', () => {
    expect(canonicalError('invalid_credentials')).toMatchObject({ retryable: false, message: 'Credenciais inválidas.' });
    expect(canonicalError('unknown')).toMatchObject({ retryable: false });
    expect(canonicalError('rate_limited', 5)).toMatchObject({ retryable: true, retryAfterSeconds: 5 });
    expect(canonicalError('rate_limited', -1)).not.toHaveProperty('retryAfterSeconds');
  });
});
