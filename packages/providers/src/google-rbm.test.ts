import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { JWT } from 'google-auth-library';
import { GoogleRbmProvider, ProviderRegistry, activationChecks, googleServiceAccountToken, type GoogleTokenSource, type ProviderContext, type ProviderEvidence, type SendRequest } from './index.js';

// Ephemeral synthetic key only. No fixture reads account credentials or uses the network.
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const now = Date.parse('2026-10-03T18:00:00Z');
function context(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return { workspaceId: 'workspace-a', connectionId: 'connection-a', environment: 'test', signal: new AbortController().signal,
    credentials: { clientEmail: 'test@fixture.iam.gserviceaccount.com', privateKey, agentName: 'brands/brand-a/agents/agent-a@rbm.goog',
      region: 'us', webhookToken: 'synthetic-webhook-token-with-at-least-32-characters' }, ...overrides };
}
const request: SendRequest = { agentId: 'agent-a@rbm.goog', recipient: '+5511999999999', idempotencyKey: 'request-a', message: { type: 'text', text: 'Olá' } };
function setup() {
  const tokenSource = vi.fn<GoogleTokenSource>(async () => 'synthetic-access-token');
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    return Response.json(init?.method === 'POST'
      ? { name: `phones/${decodeURIComponent(url.pathname.split('/')[3]!)}/agentMessages/${url.searchParams.get('messageId')}` }
      : { name: 'brands/brand-a/agents/agent-a@rbm.goog', displayName: 'Agente de teste', rcsBusinessMessagingAgent: {} });
  });
  return { provider: new GoogleRbmProvider({ fetch, tokenSource, now: () => now }), tokenSource, fetch };
}
function webhook(ctx: ProviderContext, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { rawBody: Buffer.from(JSON.stringify({ message: { data: bytes.toString('base64'), attributes: { agentId: 'untrusted-envelope' } } })),
    headers: { 'x-goog-webhook-type': 'message_callback', 'x-goog-signature': createHmac('sha512', ctx.credentials.webhookToken!).update(bytes).digest('base64') } };
}
const event = { agentId: 'agent-a@rbm.goog', senderPhoneNumber: '+5511999999999', eventId: 'event-a',
  messageId: 'message-a', sendTime: new Date(now).toISOString(), eventType: 'DELIVERED' };

describe('Google RCS proof contract', () => {
  it('translates cards, carousels and published private images without forwarding asset IDs', async () => {
    const {provider,fetch}=setup();
    const resolveMedia=vi.fn(async()=>({url:'https://app.example.test/provider-media/token',mimeType:'image/png',byteSize:100}));
    const card={title:'Card',body:'Description',media:{assetId:'private-asset',mimeType:'image/png'},suggestions:[{type:'reply' as const,text:'Yes',payload:'yes'}]};
    expect(await provider.send(context({resolveMedia}),{...request,message:{type:'rich_card',card}})).toMatchObject({accepted:true});
    const body=JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.contentMessage.richCard.standaloneCard).toMatchObject({cardOrientation:'VERTICAL',cardContent:{title:'Card',description:'Description',media:{height:'MEDIUM',contentInfo:{fileUrl:'https://app.example.test/provider-media/token'}}}});
    expect(JSON.stringify(body)).not.toContain('private-asset');
    expect(await provider.send(context({resolveMedia}),{...request,message:{type:'carousel',cards:[card,card]}})).toMatchObject({accepted:true});
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string).contentMessage.richCard.carouselCard.cardContents).toHaveLength(2);
    expect(await provider.send(context({resolveMedia}),{...request,message:{type:'media',media:card.media}})).toMatchObject({accepted:true});
    const before=fetch.mock.calls.length;
    expect(await provider.send(context({resolveMedia}),{...request,message:{type:'carousel',cards:[card]}})).toMatchObject({accepted:false,error:{code:'invalid_message'}});
    expect(await provider.send(context({resolveMedia}),{...request,message:{type:'rich_card',card:{...card,body:'a'.repeat(2001)}}})).toMatchObject({accepted:false,error:{code:'invalid_message'}});
    expect(fetch).toHaveBeenCalledTimes(before);
  });
  it('checks reachability without treating authentication or outages as ineligibility', async () => {
    const { provider, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json({ features: ['ACTION_OPEN_URL'] }));
    expect(await provider.checkEligibility(context(), request.recipient)).toBe(true);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toBe('/v1/phones/%2B5511999999999/capabilities');
    expect(url.searchParams.get('agentId')).toBe(request.agentId);
    expect(fetch.mock.calls[0]![1]?.method).toBe('GET');
    fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await provider.checkEligibility(context(), request.recipient)).toBe(false);
    for (const status of [401,403,429,503]) {
      fetch.mockResolvedValueOnce(new Response('', { status }));
      expect(await provider.checkEligibility(context(), request.recipient)).toBeNull();
    }
    fetch.mockResolvedValueOnce(Response.json({ features: [123] }));
    expect(await provider.checkEligibility(context(), request.recipient)).toBeNull();
    fetch.mockRejectedValueOnce(new Error('secret'));
    expect((await provider.getCapabilities(context(), request.recipient)).text).toBe('unknown');
    fetch.mockResolvedValueOnce(Response.json({ features: [] }));
    expect((await provider.getCapabilities(context(), request.recipient)).url_actions).toBe('unsupported');
  });
  it('authenticates initial verification before activation without exposing send', async () => {
    const { provider } = setup(); const ctx = context();
    const challenge = { headers: { 'x-goog-webhook-type': 'verification' }, rawBody: Buffer.from(JSON.stringify({ clientToken: ctx.credentials.webhookToken, secret: 'verification-secret' })) };
    expect(await provider.verifyWebhookChallenge(ctx, challenge)).toBe('verification-secret');
    expect(await provider.verifyWebhook(ctx, challenge)).toBe(false);
    expect(await provider.verifyWebhookChallenge(ctx, { ...challenge, rawBody: Buffer.from(JSON.stringify({ clientToken: 'wrong', secret: 'verification-secret' })) })).toBeNull();
    expect(await provider.verifyWebhookChallenge(ctx, { ...challenge, headers: {} })).toBeNull();
    const registry = new ProviderRegistry();
    registry.register(provider, { documentPath: 'docs/providers/google-rbm.md', reviewedAt: '2026-10-04', references: ['https://developers.google.com/'], checks: Object.fromEntries(activationChecks.map((key) => [key,false])) as ProviderEvidence['checks'] });
    expect(await registry.webhookChallenge('google_rbm')!(ctx,challenge)).toBe('verification-secret');
    expect(() => registry.resolve('google_rbm')).toThrow();
  });
  it('translates suggestion chips and encodes reply payloads', async () => {
    const { provider,fetch } = setup();
    expect(await provider.send(context(), { ...request,message: { type: 'text',text: 'Hello',suggestions: [{ type: 'reply',text: 'Yes',payload: 'yes' },{ type: 'open_url',text: 'Open',url: 'https://example.com' }] } })).toMatchObject({ accepted: true });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).contentMessage.suggestions).toEqual([{ reply: { text: 'Yes',postbackData: 'eWVz' } },{ action: { text: 'Open',postbackData:Buffer.from('https://example.com').toString('base64'),openUrlAction: { url: 'https://example.com' } } }]);
  });
  it('validates RSA service-account credentials and rejects production, SSRF inputs and extra fields', async () => {
    const { provider, fetch, tokenSource } = setup(); const ctx = context();
    expect(provider.validateCredentials(ctx.credentials, 'test')).toBe(true);
    expect(provider.getExternalAgentId(ctx.credentials, 'test')).toBe('agent-a@rbm.goog');
    expect(() => provider.getExternalAgentId(ctx.credentials, 'production')).toThrow();
    const changes: ProviderContext['credentials'][] = [{ region: 'https://attacker.test' }, { agentName: 'brands/x/agents/../../secret' },
      { clientEmail: 'user@example.test' }, { privateKey: 'invalid' }, { webhookToken: 'short' }];
    const invalid = [context({ environment: 'production' }), context({ credentials: {} }),
      context({ credentials: { ...ctx.credentials, tokenUri: 'https://attacker.test' } }),
      ...changes.map((values) => context({ credentials: { ...ctx.credentials, ...values } }))];
    for (const value of invalid) {
      expect(provider.validateCredentials(value.credentials, value.environment)).toBe(false);
      expect(await provider.send(value, request)).toMatchObject({ accepted: false, error: { code: 'invalid_credentials' } });
      expect(await provider.listAgents(value)).toEqual([]);
      expect(await provider.getAgent(value, request.agentId)).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled(); expect(tokenSource).not.toHaveBeenCalled();
  });
  it('reads only the configured agent with management scope, without claiming launch', async () => {
    const { provider, fetch, tokenSource } = setup(); const ctx = context();
    expect(await provider.testConnection(ctx)).toEqual({ status: 'connected' });
    expect(String(fetch.mock.calls[0]![0])).toBe('https://businesscommunications.googleapis.com/v1/brands/brand-a/agents/agent-a%40rbm.goog');
    expect(tokenSource.mock.calls[0]?.[1]).toBe('https://www.googleapis.com/auth/businesscommunications');
    expect(await provider.getAgent(ctx, request.agentId)).toMatchObject({ id: request.agentId, status: 'pending' });
    expect(await provider.getAgent(ctx, 'other-agent')).toBeNull();
    expect((await provider.getAgentCapabilities(ctx, 'other-agent')).text).toBe('unknown');
    expect(await provider.getHealth(ctx)).toMatchObject({ status: 'healthy', checkedAt: new Date(now).toISOString() });
    fetch.mockImplementationOnce(async () => Response.json({ name: ctx.credentials.agentName, displayName: 'Archived', isArchived: true, rcsBusinessMessagingAgent: {} }));
    expect(await provider.testConnection(ctx)).toMatchObject({ status: 'disconnected', error: { code: 'rejected' } });
  });
  it.each(['us', 'europe', 'asia'])('translates canonical text using fixed %s endpoint and messaging scope', async (region) => {
    const { provider, fetch, tokenSource } = setup();
    const ctx = context({ credentials: { ...context().credentials, region } });
    const sent = await provider.send(ctx, request);
    expect(sent).toMatchObject({ accepted: true, providerMessageId: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/) });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.hostname).toBe(`${region}-rcsbusinessmessaging.googleapis.com`);
    expect(url.searchParams.get('agentId')).toBe(request.agentId);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error', body: JSON.stringify({ contentMessage: { text: 'Olá' } }),
      headers: expect.objectContaining({ authorization: 'Bearer synthetic-access-token' }) });
    expect(tokenSource.mock.calls[0]?.[1]).toBe('https://www.googleapis.com/auth/rcsbusinessmessaging');
  });
  it('uses stable connection-scoped message UUIDs across instances and retries', async () => {
    const one = setup(); const another = setup();
    const sent = await one.provider.send(context(), request);
    expect(await one.provider.send(context(), request)).toEqual(sent);
    expect(await another.provider.send(context(), request)).toEqual(sent);
    for (const other of [context({ workspaceId: 'workspace-b' }), context({ connectionId: 'connection-b' })]) {
      expect(await one.provider.send(other, request)).not.toEqual(sent);
    }
  });
  it('blocks unsupported formats, suggestions, invalid recipients and wrong agents before authentication', async () => {
    const { provider, fetch, tokenSource } = setup();
    for (const invalid of [{ ...request, agentId: 'wrong' }, { ...request, recipient: 'invalid' }, { ...request, idempotencyKey: '' },
      { ...request, message: { type: 'text' as const, text: '😀'.repeat(3073) } }, { ...request, message: { type: 'text' as const, text: '' } }]) {
      expect(await provider.send(context(), invalid)).toMatchObject({ accepted: false, error: { code: 'invalid_message' } });
    }
    expect(await provider.send(context(), { ...request, message: { type: 'media', media: { assetId: 'asset', mimeType: 'image/png' } } })).toMatchObject({ accepted: false, error: { code: 'unsupported_capability' } });
    expect(await provider.send(context(), { ...request, message: { type: 'text', text: 'Hello', suggestions: [{ type: 'reply', text: 'x'.repeat(26), payload: 'yes' }] } })).toMatchObject({ accepted: false, error: { code: 'invalid_message' } });
    expect(provider.getProviderCapabilities().billing).toBe('unsupported');
    expect(fetch).not.toHaveBeenCalled(); expect(tokenSource).not.toHaveBeenCalled();
  });
  it.each([[400, 'invalid_message', false], [401, 'invalid_credentials', false], [403, 'invalid_credentials', false],
    [404, 'rejected', false], [429, 'rate_limited', true], [503, 'unavailable', true], [302, 'unknown', false]] as const)
  ('maps HTTP %s to safe canonical %s', async (status, code, retryable) => {
    const { provider, fetch } = setup();
    fetch.mockImplementationOnce(async () => new Response('raw-secret-provider-error', { status, headers: { 'retry-after': '5' } }));
    const result = await provider.send(context(), request);
    expect(result).toMatchObject({ accepted: false, error: { code, retryable, ...(status === 429 ? { retryAfterSeconds: 5 } : {}) } });
    expect(JSON.stringify(result)).not.toContain('raw-secret'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed success, wrong message identity, oversized and invalid UTF-8 responses', async () => {
    const { provider, fetch } = setup();
    for (const response of [new Response('{'), Response.json([]), Response.json({ name: 'wrong-message' }),
      new Response('x'.repeat(65537)), new Response(new Uint8Array([0xff]))]) {
      fetch.mockImplementationOnce(async () => response);
      expect(await provider.send(context(), request)).toMatchObject({ accepted: false, error: { code: 'unknown', retryable: false } });
    }
  });
  it('honors cancellation before tokens, during token acquisition and while reading response', async () => {
    const { provider, fetch, tokenSource } = setup(); const controller = new AbortController(); controller.abort();
    expect(await provider.send(context({ signal: controller.signal }), request)).toMatchObject({ accepted: false, error: { code: 'unavailable' } });
    expect(tokenSource).not.toHaveBeenCalled();
    const duringToken = new AbortController();
    tokenSource.mockImplementationOnce(async () => { duringToken.abort(); return 'token'; });
    expect(await provider.send(context({ signal: duringToken.signal }), request)).toMatchObject({ accepted: false, error: { code: 'unavailable' } });
    expect(fetch).not.toHaveBeenCalled();
    const duringBody = new AbortController(); const cancelled = vi.fn();
    fetch.mockImplementationOnce(async () => new Response(new ReadableStream({ pull: () => duringBody.abort(), cancel: cancelled })));
    expect(await provider.send(context({ signal: duringBody.signal }), request)).toMatchObject({ accepted: false, error: { code: 'unavailable' } });
    expect(cancelled).toHaveBeenCalled();
  });
  it('hides network and token failures', async () => {
    const { provider, fetch, tokenSource } = setup();
    tokenSource.mockRejectedValueOnce(new Error('private-key-and-access-token'));
    const result = await provider.send(context(), request);
    expect(result).toMatchObject({ accepted: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private-key'); expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error('raw upstream body'));
    expect(await provider.send(context(), request)).toMatchObject({ accepted: false, error: { code: 'unavailable' } });
  });
  it('cannot be resolved until real connection evidence passes', () => {
    const { provider } = setup(); const registry = new ProviderRegistry();
    const evidence: ProviderEvidence = { documentPath: 'docs/providers/google-rbm.md', reviewedAt: '2026-10-03',
      references: ['https://developers.google.com/business-communications/rcs-business-messaging/reference/rest/v1/phones.agentMessages/create'],
      checks: { ...Object.fromEntries(activationChecks.map((key) => [key, true])) as ProviderEvidence['checks'], connectionTestPassed: false } };
    registry.register(provider, evidence);
    expect(registry.describe('google_rbm')?.active).toBe(false);
    expect(() => registry.resolve('google_rbm')).toThrow('Provedor indisponível');
  });
});

describe('Google service-account SDK boundary', () => {
  it('uses operation-specific credentials and scopes without shared clients or automatic retries', async () => {
    const seen: JWT[] = [];
    const spy = vi.spyOn(JWT.prototype, 'getAccessToken').mockImplementation(async function (this: JWT) { seen.push(this); return { token: 'synthetic-token' }; });
    try {
      const ctx = context();
      expect(await googleServiceAccountToken(ctx, 'scope-a')).toBe('synthetic-token');
      await googleServiceAccountToken(context({ credentials: { ...ctx.credentials, clientEmail: 'other@fixture.iam.gserviceaccount.com' } }), 'scope-b');
      expect(seen[0]).not.toBe(seen[1]);
      expect(seen[0]?.email).toBe(ctx.credentials.clientEmail); expect(seen[1]?.email).toBe('other@fixture.iam.gserviceaccount.com');
      expect(seen[0]?.scopes).toEqual(['scope-a']); expect(seen[1]?.scopes).toEqual(['scope-b']);
      expect(seen[0]?.transporter.defaults).toMatchObject({ timeout: 10000, maxRedirects: 0, retry: false, retryConfig: { retry: 0 }, signal: ctx.signal });
    } finally { spy.mockRestore(); }
  });
  it('normalizes OAuth errors and never exposes SDK exceptions or empty tokens', async () => {
    const spy = vi.spyOn(JWT.prototype, 'getAccessToken');
    try {
      spy.mockRejectedValueOnce({ response: { status: 400 }, message: 'private-key-secret' });
      await expect(googleServiceAccountToken(context(), 'scope')).rejects.toMatchObject({ safeError: { code: 'invalid_credentials' } });
      spy.mockImplementationOnce(async () => ({ token: null }));
      await expect(googleServiceAccountToken(context(), 'scope')).rejects.toThrow('Credenciais inválidas.');
      spy.mockRejectedValueOnce(new Error('access-token-secret'));
      await expect(googleServiceAccountToken(context(), 'scope')).rejects.toThrow('Provedor temporariamente indisponível.');
    } finally { spy.mockRestore(); }
  });
});

describe('Google webhook verification and normalization', () => {
  it('verifies SHA512 over decoded message.data and derives tenant context only from the caller', async () => {
    const { provider } = setup(); const ctx = context(); const signed = webhook(ctx, event);
    expect(await provider.verifyWebhook(ctx, signed)).toBe(true);
    const parsed = await provider.parseWebhook(ctx, signed);
    expect(provider.normalizeEvent(ctx, parsed[0])).toEqual({ id: event.eventId, type: 'message.delivered', providerMessageId: event.messageId,
      workspaceId: ctx.workspaceId, connectionId: ctx.connectionId, providerId: 'google_rbm', occurredAt: event.sendTime, recipient: event.senderPhoneNumber });
    expect(provider.normalizeEvent(ctx, { ...event, eventType: 'READ' })).toMatchObject({ type: 'message.read' });
    const incoming = { agentId: event.agentId, senderPhoneNumber: event.senderPhoneNumber, messageId: 'reply-a', sendTime: event.sendTime, text: 'Resposta' };
    expect(provider.normalizeEvent(ctx, incoming)).toMatchObject({ type: 'message.received', message: { type: 'text', text: 'Resposta' } });
    expect(await provider.verifyWebhook(ctx, signed)).toBe(true); // Signed retries remain valid; durable inbox deduplicates later.
  });
  it('rejects altered bytes, tokens, signed agent mismatch, verification and administrative callbacks', async () => {
    const { provider } = setup(); const ctx = context(); const signed = webhook(ctx, event);
    const cases = [{ ...signed, headers: {} }, { ...signed, headers: { ...signed.headers, 'x-goog-signature': 'invalid' } },
      { ...signed, rawBody: Buffer.from('{}') }, { ...signed, rawBody: Buffer.from('{') }, { ...signed, rawBody: Buffer.alloc(65537) },
      webhook(ctx, { ...event, agentId: 'other-agent' }), { ...signed, headers: { ...signed.headers, 'x-goog-webhook-type': 'verification' } },
      { ...signed, headers: { ...signed.headers, 'x-goog-webhook-type': 'agent_callback' } },
      { ...signed, rawBody: webhook(ctx, { ...event, eventType: 'READ' }).rawBody }];
    for (const invalid of cases) {
      expect(await provider.verifyWebhook(ctx, invalid)).toBe(false); expect(await provider.parseWebhook(ctx, invalid)).toEqual([]);
    }
    expect(await provider.verifyWebhook(context({ credentials: { ...ctx.credentials, webhookToken: 'another-token-with-at-least-32-characters' } }), signed)).toBe(false);
    expect(await provider.verifyWebhook(context({ credentials: { ...ctx.credentials, agentName: 'brands/brand-b/agents/agent-b' } }), signed)).toBe(false);
  });
  it('rejects malformed canonical events and does not infer unsupported events or payload content', () => {
    const { provider } = setup(); const ctx = context();
    for (const invalid of [null, [], {}, { ...event, agentId: 'foreign' }, { ...event, eventId: '' }, { ...event, messageId: undefined },
      { ...event, sendTime: 'invalid' }, { ...event, senderPhoneNumber: 'invalid' }, { ...event, eventType: 'IS_TYPING' },
      { ...event, eventType: 'UNSUBSCRIBE',eventId:'' }, { ...event, eventType: 'SUBSCRIBE',eventId:'' }, { ...event, eventType: undefined, text: 'reply', userFile: {} }]) {
      expect(provider.normalizeEvent(ctx, invalid)).toBeNull();
    }
    const normalized = provider.normalizeEvent(ctx, { ...event, providerError: 'secret', workspaceId: 'foreign-tenant' });
    expect(normalized?.workspaceId).toBe(ctx.workspaceId); expect(JSON.stringify(normalized)).not.toContain('secret');
  });
  it('normalizes signed suggestion interactions and subscription changes without inventing outbound IDs',async()=>{
    const {provider}=setup();const ctx=context();
    const choice={...event,eventType:undefined,suggestionResponse:{type:'REPLY',postbackData:Buffer.from('interested').toString('base64'),text:'Yes'}};
    const signed=webhook(ctx,choice);expect(await provider.verifyWebhook(ctx,signed)).toBe(true);
    expect(provider.normalizeEvent(ctx,(await provider.parseWebhook(ctx,signed))[0])).toMatchObject({type:'action.selected',actionPayload:'interested',id:event.messageId});
    expect(provider.normalizeEvent(ctx,choice)).not.toHaveProperty('providerMessageId');
    expect(provider.normalizeEvent(ctx,{...choice,suggestionResponse:{type:'REPLY',postbackData:'%%%'}})).toBeNull();
    expect(provider.normalizeEvent(ctx,{...event,eventType:'UNSUBSCRIBE'})).toMatchObject({type:'contact.unsubscribe'});
    expect(provider.normalizeEvent(ctx,{...event,eventType:'SUBSCRIBE'})).toMatchObject({type:'contact.subscribe'});
  });
});
