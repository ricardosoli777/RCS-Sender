import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MockRcsProvider, canonicalError, type CanonicalMessage, type MockScenario, type ProviderContext, type RcsProvider, type SendRequest } from './index.js';

const now = Date.parse('2026-10-03T15:00:00.000Z');
function context(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return { workspaceId: 'workspace-a', connectionId: 'connection-a', environment: 'test',
    credentials: { webhookSecret: 'local-test-secret-with-at-least-32-characters' }, signal: new AbortController().signal, ...overrides };
}
function request(overrides: Partial<SendRequest> = {}): SendRequest {
  return { agentId: 'mock-agent', recipient: '+5511999999999', idempotencyKey: 'request-a', message: { type: 'text', text: 'Olá' }, ...overrides };
}
const factory = () => new MockRcsProvider({ now: () => now });

// Contract suite accepts the interface so future adapters can reuse the same expectations.
function providerContract(name: string, create: () => RcsProvider) {
  describe(name, () => {
    it('validates authentication, discovers agents and reports connection health', async () => {
      const provider = create(); const ctx = context();
      expect(provider.validateCredentials(ctx.credentials, ctx.environment)).toBe(true);
      const invalidCredentials: ProviderContext['credentials'][] = [{}, { webhookSecret: 'short' }, { webhookSecret: ctx.credentials.webhookSecret!, unexpected: 'key' }];
      for (const credentials of invalidCredentials) {
        expect(provider.validateCredentials(credentials, 'test')).toBe(false);
        expect(await provider.testConnection(context({ credentials }))).toMatchObject({ status: 'disconnected', error: { code: 'invalid_credentials', retryable: false } });
        expect(await provider.send(context({ credentials }), request())).toMatchObject({ accepted: false, error: { code: 'invalid_credentials' } });
        expect(await provider.listAgents(context({ credentials }))).toEqual([]);
      }
      expect(provider.validateCredentials(ctx.credentials, 'production')).toBe(false);
      expect(await provider.getConnectionStatus(ctx)).toBe('connected');
      expect(await provider.getHealth(ctx)).toMatchObject({ status: 'healthy' });
      const agents = await provider.listAgents(ctx);
      expect(agents).toHaveLength(1);
      expect(await provider.getAgent(ctx, agents[0]!.id)).toEqual(agents[0]);
      expect(await provider.getAgent(ctx, 'missing')).toBeNull();
      expect((await provider.getAgentCapabilities(ctx, 'missing')).text).toBe('unknown');
      expect((await provider.getAgentCapabilities(ctx, agents[0]!.id)).text).toBe('supported');
    });
    it('accepts every declared message format and rejects invalid content', async () => {
      const provider = create();
      const media = { assetId: 'local-asset', mimeType: 'image/png' };
      const messages: CanonicalMessage[] = [
        { type: 'text', text: 'Olá', suggestions: [{ type: 'reply', text: 'Sim', payload: 'yes' }, { type: 'open_url', text: 'Abrir', url: 'https://example.test' }] },
        { type: 'rich_card', card: { title: 'Título', body: 'Conteúdo', media } },
        { type: 'media', media }, { type: 'file', media },
        { type: 'carousel', cards: [{ title: 'Título', body: 'Conteúdo' }] }
      ];
      for (const [index, message] of messages.entries()) {
        expect(provider.getProviderCapabilities()[message.type]).toBe('supported');
        expect(await provider.send(context(), request({ message, idempotencyKey: `format-${index}` }))).toMatchObject({ accepted: true, providerMessageId: expect.any(String) });
      }
      for (const invalid of [request({ recipient: 'invalid' }), request({ agentId: 'missing' }), request({ idempotencyKey: '' }),
        request({ message: { type: 'text', text: ' ' } }), request({ message: { type: 'text', text: '😀'.repeat(3073) } }),
        request({ message: { type: 'carousel', cards: [] } })]) {
        expect(await provider.send(context(), invalid)).toMatchObject({ accepted: false, error: { code: 'invalid_message', retryable: false } });
      }
    });
  });
}
providerContract('Mock RCS provider contract', factory);

describe('mock scenarios and isolation', () => {
  it.each(['rejected', 'rate_limited', 'unavailable'] as MockScenario[])('normalizes %s without accepting a message', async (scenario) => {
    const provider = new MockRcsProvider({ scenario, now: () => now });
    expect(await provider.send(context(), request())).toEqual({ accepted: false, error: canonicalError(scenario as 'rejected' | 'rate_limited' | 'unavailable', scenario === 'rate_limited' ? 5 : undefined) });
    expect(await provider.getMessageStatus(context(), 'missing')).toBeNull();
    expect(await provider.getHealth(context())).toMatchObject({ status: scenario === 'unavailable' ? 'unavailable' : 'healthy' });
  });
  it('deduplicates concurrent requests, rejects conflicts and isolates connections and workspaces', async () => {
    const provider = factory(); const ctx = context();
    const [first, second] = await Promise.all([provider.send(ctx, request()), provider.send(ctx, request())]);
    expect(second).toEqual(first);
    expect(first.accepted).toBe(true); if (!first.accepted) throw new Error('Expected acceptance');
    expect(await provider.send(ctx, request({ message: { type: 'text', text: 'Alterada' } }))).toMatchObject({ accepted: false, error: { code: 'invalid_message' } });
    for (const other of [context({ workspaceId: 'workspace-b' }), context({ connectionId: 'connection-b' })]) {
      expect(await provider.getMessageStatus(other, first.providerMessageId)).toBeNull();
      expect(await provider.send(other, request())).not.toEqual(first);
    }
    const status = await provider.getMessageStatus(ctx, first.providerMessageId);
    expect(status).toMatchObject({ type: 'message.sent', workspaceId: ctx.workspaceId, connectionId: ctx.connectionId });
    if (status?.message?.type === 'text') status.message.text = 'Mutated';
    expect(await provider.getMessageStatus(ctx, first.providerMessageId)).toMatchObject({ message: { text: 'Olá' } });
  });
  it('honors cancellation and bounds state without forgetting idempotency', async () => {
    const provider = new MockRcsProvider({ maxMessages: 1 }); const ctx = context();
    const accepted = await provider.send(ctx, request());
    expect(await provider.send(ctx, request({ idempotencyKey: 'another' }))).toMatchObject({ accepted: false, error: { code: 'unavailable' } });
    expect(await provider.send(ctx, request())).toEqual(accepted);
    const controller = new AbortController(); controller.abort();
    const cancelled = context({ signal: controller.signal });
    expect(await provider.send(cancelled, request())).toMatchObject({ accepted: false, error: { code: 'unavailable' } });
    expect(await provider.getMessageStatus(cancelled, 'missing')).toBeNull();
    expect(() => provider.simulateWebhook(cancelled, [])).toThrow();
  });
});

describe('mock webhook protocol', () => {
  it('rejects authenticated invalid JSON, invalid UTF-8, oversized batches and malformed event payloads', async () => {
    const provider = factory(); const ctx = context();
    const signed = (rawBody: Uint8Array) => ({ rawBody, headers: { 'x-mock-timestamp': String(now),
      'x-mock-signature': createHmac('sha256', ctx.credentials.webhookSecret!)
        .update(JSON.stringify([ctx.workspaceId, ctx.connectionId, ctx.environment, String(now)]))
        .update('.').update(rawBody).digest('hex') } });
    for (const body of [Buffer.from('{'), Buffer.from('{}'), Buffer.from('[{}]'), Buffer.from(JSON.stringify(Array(101).fill(null))), Buffer.from([0xff])]) {
      const webhook = signed(body);
      expect(await provider.verifyWebhook(ctx, webhook)).toBe(true);
      expect(await provider.parseWebhook(ctx, webhook)).toEqual([]);
    }
  });
  it('signs, verifies, parses and normalizes every canonical event type', async () => {
    const provider = factory(); const ctx = context();
    const types = ['message.sent', 'message.delivered', 'message.read', 'message.failed', 'message.received', 'action.selected', 'contact.subscribe', 'contact.unsubscribe'] as const;
    for (const type of types) {
      const webhook = provider.simulateWebhook(ctx, [{ type, recipient: '+5511999999999',
        ...(type.startsWith('message.') ? { providerMessageId: 'mock-message' } : {}),
        ...(type === 'message.failed' ? { error: canonicalError('rejected') } : {}),
        ...(type === 'message.received' ? { message: { type: 'text' as const, text: 'Resposta' } } : {}),
        ...(type === 'action.selected' ? { actionPayload: 'selected' } : {}) }]);
      expect(await provider.verifyWebhook(ctx, webhook)).toBe(true);
      expect(await provider.parseWebhook(ctx, webhook)).toEqual([expect.objectContaining({ type, workspaceId: ctx.workspaceId, connectionId: ctx.connectionId, providerId: 'mock' })]);
    }
  });
  it('rejects tampering, missing signatures, stale or future timestamps and cross-context replay', async () => {
    const provider = factory(); const ctx = context();
    const webhook = provider.simulateWebhook(ctx, [{ type: 'message.read', recipient: '+5511999999999', providerMessageId: 'mock-message' }]);
    const tampered = { ...webhook, rawBody: Buffer.from('[]') };
    for (const invalid of [tampered, { ...webhook, headers: {} }, { ...webhook, headers: { ...webhook.headers, 'x-mock-signature': '00' } },
      { ...webhook, rawBody: Buffer.alloc(65537) }]) {
      expect(await provider.verifyWebhook(ctx, invalid)).toBe(false);
      expect(await provider.parseWebhook(ctx, invalid)).toEqual([]);
    }
    for (const other of [context({ workspaceId: 'workspace-b' }), context({ connectionId: 'connection-b' }),
      context({ environment: 'production' }), context({ credentials: { webhookSecret: 'different-local-secret-at-least-32-characters' } })]) {
      expect(await provider.verifyWebhook(other, webhook)).toBe(false);
      expect(await provider.parseWebhook(other, webhook)).toEqual([]);
    }
    for (const offset of [-300001, 300001]) expect(await new MockRcsProvider({ now: () => now + offset }).verifyWebhook(ctx, webhook)).toBe(false);
    // Valid retries remain valid: deduplication belongs to the future persistent webhook inbox.
    expect(await provider.parseWebhook(ctx, webhook)).toEqual(await provider.parseWebhook(ctx, webhook));
  });
  it('rejects malformed or foreign events and sanitizes errors without mutating input', () => {
    const provider = factory(); const ctx = context();
    const event = { id: 'event', type: 'message.failed', recipient: '+5511999999999', providerMessageId: 'mock-message',
      workspaceId: ctx.workspaceId, connectionId: ctx.connectionId, providerId: 'mock', occurredAt: new Date(now).toISOString(),
      error: { code: 'rejected', message: 'raw secret', retryable: true } };
    expect(provider.normalizeEvent(ctx, event)).toMatchObject({ error: canonicalError('rejected') });
    expect(event.error.message).toBe('raw secret');
    for (const invalid of [null, [], {}, { ...event, workspaceId: 'foreign' }, { ...event, providerId: 'external' },
      { ...event, occurredAt: 'invalid' }, { ...event, type: 'unknown' }, { ...event, providerMessageId: undefined },
      { ...event, error: undefined }, { ...event, secret: 'hidden' }, { ...event, error: { code: 'raw-error' } },
      { ...event, type: 'message.received', message: { type: 'text', text: '' } }, { ...event, type: 'action.selected' }]) {
      expect(provider.normalizeEvent(ctx, invalid)).toBeNull();
    }
    expect(() => provider.simulateWebhook(ctx, [{ type: 'message.read', recipient: 'invalid' }])).toThrow('Evento mock inválido');
  });
});
