import { capabilityMatrix, validateMessage } from './capabilities.js';
import { canonicalError } from './errors.js';
import type { Agent, CanonicalEvent, Credentials, ProviderContext, ProviderMetadata, RcsProvider, SendRequest, SendResult, WebhookRequest } from './contracts.js';

export const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096 && !/[\r\n]/.test(value);
export const phone = (value: unknown): value is string => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
export const date = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const textMatrix = capabilityMatrix({ text: 'supported', rich_card: 'unsupported', media: 'unsupported', carousel: 'unsupported', file: 'unsupported', suggested_replies: 'unsupported', url_actions: 'unsupported' });
export class VendorHttpError extends Error {
  constructor(readonly status: number) { super('Provider request failed'); }
}
export function vendorError(error: unknown) {
  const status = error instanceof VendorHttpError ? error.status : 0;
  return canonicalError(status === 401 || status === 403 ? 'invalid_credentials' : status === 400 ? 'invalid_message' : status === 429 ? 'rate_limited' : status >= 400 && status < 500 ? 'rejected' : 'unknown');
}
/** Fixed vendor hosts are selected by adapters, never by webhook payloads. No redirects or retries. */
export async function vendorJson(fetcher: typeof fetch, context: ProviderContext, url: string, headers: Record<string, string>, body?: string) {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10000)]);
  signal.throwIfAborted();
  await context.beforeRequest?.();signal.throwIfAborted();
  const response = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', headers: { accept: 'application/json', ...headers }, ...(body === undefined ? {} : { body }), redirect: 'error', signal });
  if (!response.ok) {
    if(response.status===429){const value=response.headers.get('retry-after');const seconds=value && /^\d{1,6}$/.test(value) ? Number(value) : value && Number.isFinite(Date.parse(value)) ? Math.max(1,Math.ceil((Date.parse(value)-Date.now())/1000)) : 60;await context.rateLimited?.(seconds);}
    await response.body?.cancel(); throw new VendorHttpError(response.status);
  }
  if (!response.body) throw new VendorHttpError(0);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) { signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted(); if (chunk.done) break; size += chunk.value.length; if (size > 65536) throw new VendorHttpError(0); chunks.push(chunk.value); }
    const result = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    if (!result) throw new VendorHttpError(0); return result;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export abstract class VendorTextProvider implements RcsProvider {
  constructor(protected readonly fetcher: typeof fetch = globalThis.fetch, protected readonly now: () => number = Date.now) {}
  abstract getProviderMetadata(): ProviderMetadata;
  abstract validateCredentials(credentials: Credentials, environment: string): boolean;
  abstract getExternalAgentId(credentials: Credentials, environment: string): string;
  abstract send(context: ProviderContext, request: SendRequest): Promise<SendResult>;
  getProviderCapabilities() { return textMatrix; }
  getProviderLimits() { return { maxTextCharacters: 1000, maxSuggestions: 0 }; }
  getSupportedEvents(): readonly CanonicalEvent['type'][] { return []; }
  protected assertContext(context: ProviderContext) { if (!this.validateCredentials(context.credentials, context.environment)) throw new VendorHttpError(401); context.signal.throwIfAborted(); }
  protected sendError(context: ProviderContext, request: SendRequest) {
    this.assertContext(context);
    if (request.agentId !== this.getExternalAgentId(context.credentials, context.environment) || !phone(request.recipient) || !nonempty(request.idempotencyKey) || request.idempotencyKey.length > 256) return canonicalError('invalid_message');
    const issues = validateMessage(request.message, this.getProviderCapabilities(), this.getProviderLimits());
    return issues.length ? canonicalError(issues.includes('unsupported_capability') ? 'unsupported_capability' : 'invalid_message') : null;
  }
  async testConnection(context: ProviderContext): Promise<{ status: 'unknown' | 'disconnected'; error?: ReturnType<typeof canonicalError> }> {
    try { this.assertContext(context); return { status: 'unknown' }; } catch (error) { return { status: 'disconnected', error: vendorError(error) }; }
  }
  async getConnectionStatus(context: ProviderContext) { return (await this.testConnection(context)).status; }
  async listAgents(context: ProviderContext): Promise<readonly Agent[]> { try { this.assertContext(context); const id = this.getExternalAgentId(context.credentials, context.environment); return [{ id, name: id, status: 'pending' }]; } catch { return []; } }
  async getAgent(context: ProviderContext, id: string) { return (await this.listAgents(context)).find((agent) => agent.id === id) ?? null; }
  async getAgentCapabilities(context: ProviderContext, id: string) { return await this.getAgent(context, id) ? this.getProviderCapabilities() : capabilityMatrix(); }
  async verifyWebhook(context: ProviderContext, request: WebhookRequest): Promise<boolean> { void context; void request; return false; }
  async parseWebhook(context: ProviderContext, request: WebhookRequest): Promise<readonly unknown[]> { void context; void request; return []; }
  normalizeEvent(context: ProviderContext, event: unknown): CanonicalEvent | null { void context; void event; return null; }
  async getHealth(context: ProviderContext) { return { status: (await this.getConnectionStatus(context)) === 'disconnected' ? 'unavailable' as const : 'unknown' as const, checkedAt: new Date(this.now()).toISOString() }; }
}
export function credentialSchema(keys: readonly string[], secrets: readonly string[]) { return keys.map((key) => ({ key, label: key, required: true, secret: secrets.includes(key) })); }
export function validKeys(credentials: Credentials, environment: string, keys: readonly string[]) { return environment === 'test' && Object.keys(credentials).length === keys.length && keys.every((key) => nonempty(credentials[key])) && Object.keys(credentials).every((key) => keys.includes(key)); }
export function jsonBody(request: WebhookRequest): Record<string, unknown> | null { try { if (request.rawBody.length > 65536) return null; return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.rawBody))); } catch { return null; } }
