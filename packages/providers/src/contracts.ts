export const capabilities = ['text', 'rich_card', 'media', 'carousel', 'file', 'suggested_replies', 'url_actions', 'eligibility', 'recipient_capabilities', 'revoke', 'message_status', 'cost_estimation', 'billing'] as const;
export type Capability = typeof capabilities[number];
export type CapabilityMatrix = Readonly<Record<Capability, 'supported' | 'unsupported' | 'unknown'>>;
export type Credentials = Readonly<Record<string, string>>;
export type CredentialField = Readonly<{ key: string; label: string; required: boolean; secret: boolean }>;
export type ProviderMetadata = Readonly<{ id: string; name: string; environments: readonly string[]; credentialSchema: readonly CredentialField[] }>;
export type ProviderLimits = Readonly<{ maxTextCharacters?: number; maxTitleCharacters?: number; maxCards?: number; maxSuggestions?: number; requestsPerSecond?: number }>;
export type Suggestion = { type: 'reply'; text: string; payload: string } | { type: 'open_url'; text: string; url: string };
export type Media = { assetId: string; mimeType: string };
export type RichCard = { title: string; body: string; media?: Media; suggestions?: readonly Suggestion[] };
export type CanonicalMessage = (
  { type: 'text'; text: string } | { type: 'rich_card'; card: RichCard } |
  { type: 'media' | 'file'; media: Media; text?: string } | { type: 'carousel'; cards: readonly RichCard[] }
) & { suggestions?: readonly Suggestion[] };
export type ProviderContext = Readonly<{ workspaceId: string; connectionId: string; environment: string; credentials: Credentials; signal: AbortSignal;
  resolveMedia?: (media: Media) => Promise<{ url: string; mimeType: string; byteSize: number }>;
  beforeRequest?:()=>Promise<void>;rateLimited?:(retryAfterSeconds:number)=>Promise<void> }>;
export type Agent = { id: string; name: string; status: 'active' | 'pending' | 'unavailable' };
export type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
export type Health = { status: 'healthy' | 'degraded' | 'unavailable' | 'unknown'; checkedAt: string };
export const eventTypes = ['message.sent', 'message.delivered', 'message.read', 'message.failed', 'message.received', 'action.selected', 'link.clicked', 'contact.subscribe', 'contact.unsubscribe'] as const;
export type CanonicalEvent = Readonly<{ id: string; type: typeof eventTypes[number]; workspaceId: string; connectionId: string; providerId: string; occurredAt: string;
  providerMessageId?: string; dispatchKey?:string; recipient: string; message?: CanonicalMessage; actionPayload?: string; error?: CanonicalError }>;
export type ErrorCode = 'invalid_credentials' | 'invalid_message' | 'unsupported_capability' | 'rate_limited' | 'unavailable' | 'rejected' | 'unknown';
export type CanonicalError = Readonly<{ code: ErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number }>;
export type SendRequest = { agentId: string; recipient: string; idempotencyKey: string; message: CanonicalMessage };
export type SendResult = { accepted: true; providerMessageId: string } | { accepted: false; error: CanonicalError };
export type WebhookRequest = { rawBody: Uint8Array; headers: Readonly<Record<string, string | undefined>> };

export interface RcsProvider {
  /** Pure local identity calculation, only when the vendor accepts caller-assigned IDs. */
  getSendIdentity?(context:ProviderContext,request:SendRequest):string;
  requestEligibility?(context:ProviderContext,recipient:string,requestId:string):Promise<boolean>;
  normalizeEligibility?(context:ProviderContext,input:unknown):{requestId:string;recipient:string;eligible:boolean|null}|null;
  verifyWebhookChallenge?(context: ProviderContext, request: WebhookRequest): Promise<string | null>;
  getSupportedEvents?(): readonly typeof eventTypes[number][];
  getProviderMetadata(): ProviderMetadata;
  getProviderCapabilities(): CapabilityMatrix;
  getProviderLimits(): ProviderLimits;
  validateCredentials(credentials: Credentials, environment: string): boolean;
  // Stable identity present in signed callbacks; ownership is reserved by the host application.
  getExternalAgentId?(credentials: Credentials, environment: string): string;
  testConnection(context: ProviderContext): Promise<{ status: ConnectionStatus; error?: CanonicalError }>;
  getConnectionStatus(context: ProviderContext): Promise<ConnectionStatus>;
  listAgents(context: ProviderContext): Promise<readonly Agent[]>;
  getAgent(context: ProviderContext, id: string): Promise<Agent | null>;
  getAgentCapabilities(context: ProviderContext, id: string): Promise<CapabilityMatrix>;
  send(context: ProviderContext, request: SendRequest): Promise<SendResult>;
  verifyWebhook(context: ProviderContext, request: WebhookRequest): Promise<boolean>;
  parseWebhook(context: ProviderContext, request: WebhookRequest): Promise<readonly unknown[]>;
  normalizeEvent(context: ProviderContext, event: unknown): CanonicalEvent | null;
  getHealth(context: ProviderContext): Promise<Health>;
  checkEligibility?(context: ProviderContext, recipient: string): Promise<boolean | null>;
  getCapabilities?(context: ProviderContext, recipient: string): Promise<CapabilityMatrix>;
  revoke?(context: ProviderContext, providerMessageId: string): Promise<{ revoked: boolean; error?: CanonicalError }>;
  getMessageStatus?(context: ProviderContext, providerMessageId: string): Promise<CanonicalEvent | null>;
  estimateCost?(context: ProviderContext, request: SendRequest): Promise<{ amount: string; currency: string } | null>;
  normalizeBillingData?(context: ProviderContext, data: unknown): { amount: string; currency: string } | null;
}
