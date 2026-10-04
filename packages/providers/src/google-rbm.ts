import { createHash, createHmac, createPrivateKey, timingSafeEqual } from 'node:crypto';
import { JWT } from 'google-auth-library';
import { capabilityMatrix, validateMessage } from './capabilities.js';
import { canonicalError } from './errors.js';
import {actionFields} from './action-correlation.js';
import type { Agent, CanonicalError, CanonicalEvent, Credentials, ProviderContext, RcsProvider, SendRequest, SendResult, WebhookRequest, Suggestion,RichCard,CanonicalMessage } from './contracts.js';

const managementScope = 'https://www.googleapis.com/auth/businesscommunications';
const messagingScope = 'https://www.googleapis.com/auth/rcsbusinessmessaging';
const hosts = { us: 'us-rcsbusinessmessaging.googleapis.com', europe: 'europe-rcsbusinessmessaging.googleapis.com', asia: 'asia-rcsbusinessmessaging.googleapis.com' } as const;
const credentialKeys = ['clientEmail', 'privateKey', 'agentName', 'region', 'webhookToken'] as const;
const namePattern = /^brands\/[a-zA-Z0-9_-]{1,128}\/agents\/[a-zA-Z0-9@._-]{1,128}$/;
const phonePattern = /^\+[1-9]\d{7,14}$/;
const matrix = capabilityMatrix({ text: 'supported', rich_card: 'supported', media: 'supported', carousel: 'supported',
  file: 'unsupported', suggested_replies: 'supported', url_actions: 'supported', eligibility: 'supported',
  recipient_capabilities: 'supported', revoke: 'unsupported', message_status: 'unsupported', cost_estimation: 'unsupported', billing: 'unsupported' });
const maximumBytes = 65536;
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null; }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function agentId(context: ProviderContext) { return context.credentials.agentName?.split('/')[3] ?? ''; }
class GoogleOperationError extends Error {
  constructor(readonly safeError: CanonicalError) { super(safeError.message); }
}
function httpError(status: number, retryAfter?: string | null): CanonicalError {
  if (status === 401 || status === 403) return canonicalError('invalid_credentials');
  if (status === 400) return canonicalError('invalid_message');
  if (status === 404) return canonicalError('rejected');
  if (status === 429) return canonicalError('rate_limited', retryAfter && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : undefined);
  if (status >= 500 && status <= 599) return canonicalError('unavailable');
  return canonicalError('unknown');
}
function safeError(error: unknown): CanonicalError { return error instanceof GoogleOperationError ? error.safeError : canonicalError('unavailable'); }

export type GoogleTokenSource = (context: ProviderContext, scope: string) => Promise<string>;
export type GoogleRbmOptions = { fetch?: typeof fetch; tokenSource?: GoogleTokenSource; now?: () => number };

// Uses Google's SDK without ADC, caller-supplied URLs, files or shared credential caches.
export const googleServiceAccountToken: GoogleTokenSource = async (context, scope) => {
  await context.beforeRequest?.();context.signal.throwIfAborted();
  const client = new JWT({ email: context.credentials.clientEmail, key: context.credentials.privateKey, scopes: [scope],
    transporterOptions: { timeout: 10000, signal: context.signal, maxRedirects: 0, retry: false, retryConfig: { retry: 0 } } });
  try {
    const result = await client.getAccessToken();
    if (!text(result.token)) throw new GoogleOperationError(canonicalError('invalid_credentials'));
    return result.token;
  } catch (error) {
    if (error instanceof GoogleOperationError) throw error;
    const status = object(object(error)?.response)?.status;
    throw new GoogleOperationError(typeof status === 'number' && [400, 401, 403].includes(status)
      ? canonicalError('invalid_credentials') : canonicalError('unavailable'));
  }
};

/** An inactive-by-default documented adapter. See docs/providers/google-rbm.md. */
export class GoogleRbmProvider implements RcsProvider {
  private readonly fetch: typeof fetch;
  private readonly tokenSource: GoogleTokenSource;
  private readonly now: () => number;
  private readonly tokens=new WeakMap<ProviderContext,Map<string,Promise<string>>>();
  constructor(options: GoogleRbmOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.tokenSource = options.tokenSource ?? googleServiceAccountToken;
    this.now = options.now ?? Date.now;
  }
  getProviderMetadata() {
    return { id: 'google_rbm', name: 'Google RCS for Business', environments: ['test'], credentialSchema: credentialKeys.map((key) => ({
      key, label: key, required: true, secret: ['privateKey', 'webhookToken'].includes(key) })) };
  }
  getProviderCapabilities() { return matrix; }
  getSupportedEvents() { return ['message.delivered','message.read','message.received','action.selected','link.clicked','contact.subscribe','contact.unsubscribe'] as const; }
  getExternalAgentId(credentials: Credentials, environment: string) {
    if (!this.validateCredentials(credentials, environment)) throw new Error('Credenciais inválidas.');
    return credentials.agentName!.split('/')[3]!;
  }
  getProviderLimits() { return { maxTextCharacters: 3072,maxTitleCharacters: 200,maxCards: 10, maxSuggestions: 11 }; }
  validateCredentials(credentials: Credentials, environment: string) {
    if (environment !== 'test' || Object.keys(credentials).length !== credentialKeys.length
      || Object.keys(credentials).some((key) => !credentialKeys.includes(key as typeof credentialKeys[number]))
      || credentialKeys.some((key) => !text(credentials[key]))
      || !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(credentials.clientEmail!)
      || !namePattern.test(credentials.agentName!) || !Object.hasOwn(hosts, credentials.region!)
      || credentials.webhookToken!.length < 32 || credentials.webhookToken!.length > 256
      || credentials.privateKey!.length > 16384) return false;
    try {
      const key = createPrivateKey(credentials.privateKey!);
      return key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
    } catch { return false; }
  }
  private assertContext(context: ProviderContext) {
    if (!this.validateCredentials(context.credentials, context.environment)) throw new GoogleOperationError(canonicalError('invalid_credentials'));
    if (!context.workspaceId || !context.connectionId || context.signal.aborted) throw new GoogleOperationError(canonicalError('unavailable'));
  }
  private async call(context: ProviderContext, scope: string, url: URL, body?: unknown): Promise<JsonObject> {
    this.assertContext(context);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10000)]);
    let tokens=this.tokens.get(context);if(!tokens){tokens=new Map();this.tokens.set(context,tokens);}
    let pending=tokens.get(scope);if(!pending){pending=this.tokenSource({...context,signal},scope);tokens.set(scope,pending);}
    const token=await pending;
    signal.throwIfAborted();
    await context.beforeRequest?.();signal.throwIfAborted();
    if (!text(token) || /[\r\n]/.test(token)) throw new GoogleOperationError(canonicalError('invalid_credentials'));
    const response = await this.fetch(url, { method: body === undefined ? 'GET' : 'POST', signal, redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) {
      if(response.status===429){const retry=response.headers.get('retry-after');await context.rateLimited?.(retry && /^\d{1,6}$/.test(retry) ? Number(retry) : 60);}
      await response.body?.cancel();
      throw new GoogleOperationError(httpError(response.status, response.headers.get('retry-after')));
    }
    if (!response.body) throw new GoogleOperationError(canonicalError('unknown'));
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      while (true) {
        const chunk = await reader.read(); signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximumBytes) { await reader.cancel(); throw new GoogleOperationError(canonicalError('unknown')); }
        chunks.push(chunk.value);
      }
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        const parsed = object(value);
        if (!parsed) throw new Error('Invalid response');
        return parsed;
      } catch { throw new GoogleOperationError(canonicalError('unknown')); }
    } finally {
      signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  private async configuredAgent(context: ProviderContext): Promise<Agent> {
    this.assertContext(context);
    const name = context.credentials.agentName!;
    const url = new URL(`https://businesscommunications.googleapis.com/v1/${name.split('/').map(encodeURIComponent).join('/')}`);
    const value = await this.call(context, managementScope, url);
    if (value.name !== name || !text(value.displayName) || !object(value.rcsBusinessMessagingAgent)) throw new GoogleOperationError(canonicalError('unknown'));
    if (value.isArchived === true) return { id: agentId(context), name: value.displayName, status: 'unavailable' };
    // Reading metadata proves access, not launch or carrier availability.
    return { id: agentId(context), name: value.displayName, status: 'pending' };
  }
  async testConnection(context: ProviderContext) {
    try {
      const agent = await this.configuredAgent(context);
      return agent.status === 'unavailable' ? { status: 'disconnected' as const, error: canonicalError('rejected') } : { status: 'connected' as const };
    } catch (error) { return { status: 'disconnected' as const, error: safeError(error) }; }
  }
  async getConnectionStatus(context: ProviderContext) { return (await this.testConnection(context)).status; }
  async listAgents(context: ProviderContext) {
    try { return [await this.configuredAgent(context)]; } catch { return []; }
  }
  async getAgent(context: ProviderContext, id: string) {
    if (id !== agentId(context)) return null;
    return (await this.listAgents(context))[0] ?? null;
  }
  async getAgentCapabilities(context: ProviderContext, id: string) { return await this.getAgent(context, id) ? matrix : capabilityMatrix(); }
  private async recipientFeatures(context: ProviderContext, recipient: string): Promise<readonly string[] | null> {
    this.assertContext(context);
    if (!phonePattern.test(recipient)) throw new GoogleOperationError(canonicalError('invalid_message'));
    const url = new URL(`https://${hosts[context.credentials.region as keyof typeof hosts]}/v1/phones/${encodeURIComponent(recipient)}/capabilities`);
    url.searchParams.set('agentId', agentId(context));
    try {
      const value = await this.call(context, messagingScope, url);
      if (value.features !== undefined && (!Array.isArray(value.features) || value.features.some((feature: unknown) => typeof feature !== 'string'))) throw new GoogleOperationError(canonicalError('unknown'));
      return (value.features ?? []) as string[];
    } catch (error) {
      if (error instanceof GoogleOperationError && error.safeError.code === 'rejected') return null;
      throw error;
    }
  }
  async checkEligibility(context: ProviderContext, recipient: string): Promise<boolean | null> {
    try { return (await this.recipientFeatures(context, recipient)) !== null; } catch { return null; }
  }
  async getCapabilities(context: ProviderContext, recipient: string) {
    try {
      const features = await this.recipientFeatures(context, recipient);
      if (features === null) return capabilityMatrix(Object.fromEntries(Object.keys(matrix).map((key) => [key, 'unsupported'])));
      return capabilityMatrix({ ...matrix, rich_card: features.includes('RICHCARD_STANDALONE') ? 'supported' : 'unsupported',
        carousel: features.includes('RICHCARD_CAROUSEL') ? 'supported' : 'unsupported',url_actions: features.includes('ACTION_OPEN_URL') ? 'supported' : 'unsupported' });
    } catch { return capabilityMatrix(); }
  }
  async verifyWebhookChallenge(context: ProviderContext, request: WebhookRequest): Promise<string | null> {
    try {
      this.assertContext(context);
      if (request.headers['x-goog-webhook-type'] !== 'verification' || request.rawBody.byteLength > 4096) return null;
      const value = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.rawBody)));
      if (!value || Object.keys(value).length !== 2 || typeof value.clientToken !== 'string' || typeof value.secret !== 'string'
        || !value.secret.length || value.secret.length > 2048 || /[\u0000-\u001f\u007f]/.test(value.secret)) return null;
      const received = createHash('sha256').update(value.clientToken).digest();
      const expected = createHash('sha256').update(context.credentials.webhookToken!).digest();
      return timingSafeEqual(received, expected) ? value.secret : null;
    } catch { return null; }
  }
  private messageId(context: ProviderContext, key: string) {
    // RFC 4122 UUID v5; the connection-scoped name makes retries stable across processes.
    const hash = createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
      .update(JSON.stringify(['rcs-google-message-v1', context.workspaceId, context.connectionId, context.environment, agentId(context), key])).digest();
    hash[6] = (hash[6]! & 0x0f) | 0x50; hash[8] = (hash[8]! & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  getSendIdentity(context:ProviderContext,request:SendRequest){this.assertContext(context);return this.messageId(context,request.idempotencyKey);}
  private suggestions(items?: readonly Suggestion[]) {
    return items?.map((item) => {
      if (Array.from(item.text).length > 25 || (item.type === 'reply' && Buffer.byteLength(item.payload) > 1536)) throw new GoogleOperationError(canonicalError('invalid_message'));
      return item.type === 'reply' ? { reply: { text: item.text,postbackData: Buffer.from(item.payload).toString('base64') } }
        : { action: { text: item.text,postbackData:Buffer.from(item.url).toString('base64'),openUrlAction: { url: item.url } } };
    });
  }
  private async content(context: ProviderContext,message: CanonicalMessage): Promise<JsonObject> {
    const media = async (asset: {assetId:string;mimeType:string}) => {
      if (!context.resolveMedia || !['image/png','image/jpeg'].includes(asset.mimeType)) throw new GoogleOperationError(canonicalError('unsupported_capability'));
      const published = await context.resolveMedia(asset);
      const url = new URL(published.url);
      if (url.protocol !== 'https:' || url.username || url.password || published.mimeType !== asset.mimeType || published.byteSize > 2097152) throw new GoogleOperationError(canonicalError('invalid_message'));
      return { fileUrl: url.href };
    };
    const card = async (value: RichCard) => {
      if (Array.from(value.body).length > 2000 || (value.suggestions?.length ?? 0)>4) throw new GoogleOperationError(canonicalError('invalid_message'));
      return { title: value.title,description: value.body,...(value.media ? {media:{height:'MEDIUM',contentInfo:await media(value.media)}} : {}),...(value.suggestions?.length ? {suggestions:this.suggestions(value.suggestions)} : {}) };
    };
    const chips = message.suggestions?.length ? {suggestions:this.suggestions(message.suggestions)} : {};
    if (message.type === 'text') return {text:message.text,...chips};
    if (message.type === 'rich_card') return {richCard:{standaloneCard:{cardOrientation:'VERTICAL',cardContent:await card(message.card)}},...chips};
    if (message.type === 'carousel') {
      if (message.cards.length<2) throw new GoogleOperationError(canonicalError('invalid_message'));
      const cards = []; for (const value of message.cards) cards.push(await card(value));
      return {richCard:{carouselCard:{cardWidth:'MEDIUM',cardContents:cards}},...chips};
    }
    if (message.type === 'media' && !message.text) return {contentInfo:await media(message.media),...chips};
    throw new GoogleOperationError(canonicalError('unsupported_capability'));
  }
  async send(context: ProviderContext, request: SendRequest): Promise<SendResult> {
    try {
      this.assertContext(context);
      if (request.agentId !== agentId(context) || !phonePattern.test(request.recipient) || !text(request.idempotencyKey)
        || request.idempotencyKey.length > 256) return { accepted: false, error: canonicalError('invalid_message') };
      const issues = validateMessage(request.message, matrix, this.getProviderLimits());
      if (issues.length) return { accepted: false, error: canonicalError(issues.includes('unsupported_capability') ? 'unsupported_capability' : 'invalid_message') };
      const contentMessage = await this.content(context,request.message);
      const id = this.messageId(context, request.idempotencyKey);
      const url = new URL(`https://${hosts[context.credentials.region as keyof typeof hosts]}/v1/phones/${encodeURIComponent(request.recipient)}/agentMessages`);
      url.searchParams.set('agentId', request.agentId); url.searchParams.set('messageId', id);
      const value = await this.call(context, messagingScope, url, { contentMessage });
      if (value.name !== `phones/${request.recipient}/agentMessages/${id}`) return { accepted: false, error: canonicalError('unknown') };
      return { accepted: true, providerMessageId: id };
    } catch (error) { return { accepted: false, error: safeError(error) }; }
  }
  private decodedWebhook(context: ProviderContext, request: WebhookRequest): JsonObject | null {
    try {
      this.assertContext(context);
      if (request.rawBody.byteLength > maximumBytes || request.headers['x-goog-webhook-type'] !== 'message_callback') return null;
      const envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.rawBody)));
      const data = object(envelope?.message)?.data;
      const signature = request.headers['x-goog-signature'];
      if (typeof data !== 'string' || !data || data.length > maximumBytes || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
        || !signature || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return null;
      const bytes = Buffer.from(data, 'base64');
      if (bytes.toString('base64') !== data || bytes.byteLength > maximumBytes) return null;
      const digest = createHmac('sha512', context.credentials.webhookToken!).update(bytes).digest();
      if (!timingSafeEqual(digest, Buffer.from(signature, 'base64'))) return null;
      const event = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      // Agent identity is inside the signed payload; envelope attributes are untrusted.
      return event?.agentId === agentId(context) ? event : null;
    } catch { return null; }
  }
  async verifyWebhook(context: ProviderContext, request: WebhookRequest) { return this.decodedWebhook(context, request) !== null; }
  async parseWebhook(context: ProviderContext, request: WebhookRequest): Promise<readonly unknown[]> {
    const event = this.decodedWebhook(context, request);
    return event ? [event] : [];
  }
  normalizeEvent(context: ProviderContext, input: unknown): CanonicalEvent | null {
    try { this.assertContext(context); } catch { return null; }
    const value = object(input);
    if (!value || value.agentId !== agentId(context) || !text(value.senderPhoneNumber) || !phonePattern.test(value.senderPhoneNumber)
      || typeof value.sendTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.sendTime) || !Number.isFinite(Date.parse(value.sendTime))) return null;
    const base = { workspaceId: context.workspaceId, connectionId: context.connectionId, providerId: 'google_rbm',
      occurredAt: new Date(value.sendTime).toISOString(), recipient: value.senderPhoneNumber };
    if (value.eventType === 'DELIVERED' || value.eventType === 'READ') {
      if (!text(value.eventId) || !text(value.messageId)) return null;
      return { ...base, id: value.eventId, type: value.eventType === 'DELIVERED' ? 'message.delivered' : 'message.read', providerMessageId: value.messageId };
    }
    if(value.eventType==='SUBSCRIBE' || value.eventType==='UNSUBSCRIBE'){
      if(!text(value.eventId))return null;
      return {...base,id:value.eventId,type:value.eventType==='SUBSCRIBE'?'contact.subscribe':'contact.unsubscribe'};
    }
    const suggestion=object(value.suggestionResponse);
    if(value.eventType===undefined && text(value.messageId) && suggestion && value.text===undefined && value.userFile===undefined && value.location===undefined){
      if(!['REPLY','ACTION'].includes(String(suggestion.type)) || typeof suggestion.postbackData!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(suggestion.postbackData))return null;
      const bytes=Buffer.from(suggestion.postbackData,'base64');if(bytes.toString('base64')!==suggestion.postbackData || bytes.length>1536)return null;
      let payload:string;try{payload=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
      if(!payload.trim())return null;
      // Incoming message ID identifies this interaction, not the original outbound message.
      return {...base,id:value.messageId,type:suggestion.type==='REPLY'?'action.selected':'link.clicked',...actionFields(payload)};
    }
    if (value.eventType !== undefined || !text(value.messageId) || typeof value.text !== 'string'
      || !value.text.trim() || Array.from(value.text).length > 3072 || value.userFile !== undefined
      || value.location !== undefined || value.suggestionResponse !== undefined) return null;
    return { ...base, id: value.messageId, providerMessageId: value.messageId, type: 'message.received', message: { type: 'text', text: value.text } };
  }
  async getHealth(context: ProviderContext) {
    return { status: (await this.getConnectionStatus(context)) === 'connected' ? 'healthy' as const : 'unavailable' as const,
      checkedAt: new Date(this.now()).toISOString() };
  }
}
