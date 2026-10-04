import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { capabilities, eventTypes, type CanonicalEvent, type Credentials, type ProviderContext, type RcsProvider, type SendRequest, type SendResult, type WebhookRequest } from './contracts.js';
import { capabilityMatrix, validateMessage } from './capabilities.js';
import { canonicalError } from './errors.js';

export type MockScenario = 'success' | 'rejected' | 'rate_limited' | 'unavailable';
export type MockOptions = { scenario?: MockScenario; now?: () => number; maxMessages?: number };
export type MockEventInput = Pick<CanonicalEvent, 'type' | 'recipient' | 'providerMessageId' | 'message' | 'actionPayload' | 'error'>;
const matrix = capabilityMatrix(Object.fromEntries(capabilities.map((key) => [key,
  ['eligibility', 'recipient_capabilities', 'revoke', 'cost_estimation', 'billing'].includes(key) ? 'unsupported' : 'supported'])));
const limits = Object.freeze({ maxTextCharacters: 3072, maxTitleCharacters: 200, maxCards: 10, maxSuggestions: 4 });
const agent = Object.freeze({ id: 'mock-agent', name: 'Agente simulado', status: 'active' as const });
const recipientPattern = /^\+[1-9]\d{7,14}$/;
const maxBodyBytes = 64 * 1024;

// All state is local to this instance. No network, persistence or production activation.
export class MockRcsProvider implements RcsProvider {
  private readonly now: () => number;
  private readonly scenario: MockScenario;
  private readonly maximum: number;
  private readonly messages = new Map<string, { fingerprint: string; event: CanonicalEvent }>();

  constructor(options: MockOptions = {}) {
    this.now = options.now ?? Date.now;
    this.scenario = options.scenario ?? 'success';
    this.maximum = options.maxMessages ?? 1000;
    if (!['success', 'rejected', 'rate_limited', 'unavailable'].includes(this.scenario)
      || !Number.isSafeInteger(this.maximum) || this.maximum < 1) throw new Error('Configuração mock inválida');
  }

  getProviderMetadata() {
    return { id: 'mock', name: 'Mock RCS (simulação local)', environments: ['test'],
      credentialSchema: [{ key: 'webhookSecret', label: 'Segredo local de webhook', required: true, secret: true }] };
  }
  getProviderCapabilities() { return matrix; }
  getSupportedEvents() { return eventTypes; }
  getProviderLimits() { return limits; }
  validateCredentials(credentials: Credentials, environment: string) {
    return environment === 'test' && Object.keys(credentials).length === 1
      && typeof credentials.webhookSecret === 'string' && credentials.webhookSecret.trim().length >= 32
      && credentials.webhookSecret.length <= 256;
  }
  private contextError(context: ProviderContext) {
    if (!this.validateCredentials(context.credentials, context.environment)) return canonicalError('invalid_credentials');
    if (context.signal.aborted || !context.workspaceId || !context.connectionId) return canonicalError('unavailable');
    return undefined;
  }
  async testConnection(context: ProviderContext) {
    const error = this.contextError(context) ?? (this.scenario === 'unavailable' ? canonicalError('unavailable') : undefined);
    return error ? { status: 'disconnected' as const, error } : { status: 'connected' as const };
  }
  async getConnectionStatus(context: ProviderContext) { return (await this.testConnection(context)).status; }
  async listAgents(context: ProviderContext) { return (await this.getConnectionStatus(context)) === 'connected' ? [{ ...agent }] : []; }
  async getAgent(context: ProviderContext, id: string) { return (await this.listAgents(context)).find((value) => value.id === id) ?? null; }
  async getAgentCapabilities(context: ProviderContext, id: string) {
    return await this.getAgent(context, id) ? matrix : capabilityMatrix();
  }
  private scope(context: ProviderContext) { return [context.workspaceId, context.connectionId, context.environment]; }
  async send(context: ProviderContext, request: SendRequest): Promise<SendResult> {
    const error = this.contextError(context);
    if (error) return { accepted: false, error };
    if (request.agentId !== agent.id || !recipientPattern.test(request.recipient) || !request.idempotencyKey.trim()
      || request.idempotencyKey.length > 256) return { accepted: false, error: canonicalError('invalid_message') };
    const issues = validateMessage(request.message, matrix, limits);
    if (issues.length) return { accepted: false, error: canonicalError(issues.includes('unsupported_capability') ? 'unsupported_capability' : 'invalid_message') };
    const key = JSON.stringify([...this.scope(context), request.idempotencyKey]);
    const fingerprint = createHash('sha256').update(JSON.stringify([request.agentId, request.recipient, request.message])).digest('hex');
    const previous = this.messages.get(key);
    if (previous) return previous.fingerprint === fingerprint
      ? { accepted: true, providerMessageId: previous.event.providerMessageId! }
      : { accepted: false, error: canonicalError('invalid_message') };
    if (this.scenario !== 'success') return { accepted: false, error: canonicalError(this.scenario, this.scenario === 'rate_limited' ? 5 : undefined) };
    // Fail closed at capacity instead of evicting and accidentally accepting a duplicate.
    if (this.messages.size >= this.maximum) return { accepted: false, error: canonicalError('unavailable') };
    const providerMessageId = `mock-${randomUUID()}`;
    const event: CanonicalEvent = { id: randomUUID(), type: 'message.sent', workspaceId: context.workspaceId,
      connectionId: context.connectionId, providerId: 'mock', occurredAt: new Date(this.now()).toISOString(),
      providerMessageId, recipient: request.recipient, message: structuredClone(request.message) };
    this.messages.set(key, { fingerprint, event });
    return { accepted: true, providerMessageId };
  }
  async getMessageStatus(context: ProviderContext, providerMessageId: string) {
    if (this.contextError(context)) return null;
    for (const { event } of this.messages.values()) {
      if (event.workspaceId === context.workspaceId && event.connectionId === context.connectionId && event.providerMessageId === providerMessageId) return structuredClone(event);
    }
    return null;
  }
  private signature(context: ProviderContext, timestamp: string, body: Uint8Array) {
    return createHmac('sha256', context.credentials.webhookSecret!)
      .update(JSON.stringify([...this.scope(context), timestamp])).update('.').update(body).digest();
  }
  private verified(context: ProviderContext, request: WebhookRequest, fresh: boolean) {
    if (this.contextError(context) || request.rawBody.byteLength > maxBodyBytes) return false;
    const timestamp = request.headers['x-mock-timestamp'];
    const signature = request.headers['x-mock-signature'];
    if (!timestamp || !/^\d{10,13}$/.test(timestamp) || fresh && Math.abs(this.now() - Number(timestamp)) > 300_000
      || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
    return timingSafeEqual(this.signature(context, timestamp, request.rawBody), Buffer.from(signature, 'hex'));
  }
  async verifyWebhook(context: ProviderContext, request: WebhookRequest) { return this.verified(context, request, true); }
  async parseWebhook(context: ProviderContext, request: WebhookRequest): Promise<readonly unknown[]> {
    if (!this.verified(context, request, false)) return [];
    try {
      const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.rawBody));
      if (!Array.isArray(payload) || payload.length > 100) return [];
      const events = payload.map((event) => this.normalizeEvent(context, event));
      return events.every((event) => event !== null) ? events : [];
    } catch { return []; }
  }
  normalizeEvent(context: ProviderContext, value: unknown): CanonicalEvent | null {
    if (this.contextError(context) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const event = { ...value } as Record<string, unknown>;
    const keys = ['id', 'type', 'workspaceId', 'connectionId', 'providerId', 'occurredAt', 'recipient', 'providerMessageId', 'message', 'actionPayload', 'error'];
    if (Object.keys(event).some((key) => !keys.includes(key)) || event.workspaceId !== context.workspaceId
      || event.connectionId !== context.connectionId || event.providerId !== 'mock'
      || typeof event.id !== 'string' || !event.id.trim() || typeof event.type !== 'string'
      || !eventTypes.includes(event.type as CanonicalEvent['type']) || typeof event.recipient !== 'string'
      || !recipientPattern.test(event.recipient) || typeof event.occurredAt !== 'string'
      || !Number.isFinite(Date.parse(event.occurredAt))) return null;
    if (event.type.startsWith('message.') && (typeof event.providerMessageId !== 'string' || !event.providerMessageId.trim())) return null;
    if (event.providerMessageId !== undefined && (typeof event.providerMessageId !== 'string' || !event.providerMessageId.trim())) return null;
    if (event.actionPayload !== undefined && (typeof event.actionPayload !== 'string' || !event.actionPayload.trim())) return null;
    if (['action.selected','link.clicked'].includes(event.type as string) && event.actionPayload === undefined) return null;
    // Received content is deliberately text-only in the mock wire protocol.
    if (event.message !== undefined) {
      if (!event.message || typeof event.message !== 'object' || Array.isArray(event.message)) return null;
      const message = event.message as Record<string, unknown>;
      if (Object.keys(message).some((key) => !['type', 'text'].includes(key)) || message.type !== 'text'
        || typeof message.text !== 'string' || validateMessage({ type: 'text', text: message.text }, matrix, limits).length) return null;
    }
    if (event.type === 'message.received' && event.message === undefined) return null;
    if (event.error !== undefined) {
      if (!event.error || typeof event.error !== 'object' || Array.isArray(event.error)) return null;
      const code = (event.error as Record<string, unknown>).code;
      if (!['invalid_credentials', 'invalid_message', 'unsupported_capability', 'rate_limited', 'unavailable', 'rejected', 'unknown'].includes(String(code))) return null;
      event.error = canonicalError(code as Parameters<typeof canonicalError>[0]);
    }
    if (event.type === 'message.failed' && event.error === undefined) return null;
    return structuredClone(event) as CanonicalEvent;
  }
  simulateWebhook(context: ProviderContext, inputs: readonly MockEventInput[]): WebhookRequest {
    if (this.contextError(context) || !inputs.length || inputs.length > 100) throw new Error('Simulação mock inválida');
    const events = inputs.map((input) => this.normalizeEvent(context, { ...input, id: randomUUID(), workspaceId: context.workspaceId,
      connectionId: context.connectionId, providerId: 'mock', occurredAt: new Date(this.now()).toISOString() }));
    if (events.some((event) => !event)) throw new Error('Evento mock inválido');
    const rawBody = Buffer.from(JSON.stringify(events));
    if (rawBody.byteLength > maxBodyBytes) throw new Error('Payload mock excede o limite');
    const timestamp = String(this.now());
    return { rawBody, headers: { 'x-mock-timestamp': timestamp, 'x-mock-signature': this.signature(context, timestamp, rawBody).toString('hex') } };
  }
  async getHealth(context: ProviderContext) {
    return { status: (await this.getConnectionStatus(context)) === 'connected' ? 'healthy' as const : 'unavailable' as const,
      checkedAt: new Date(this.now()).toISOString() };
  }
}
