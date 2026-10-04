import { ProviderRegistry, canonicalError, type CanonicalError, type Credentials,type ProviderContext } from '@rcs/providers';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';
import type { ProviderStore } from '../domain/contracts.js';

export class ProviderInputError extends Error {
  constructor(readonly reason: 'unavailable' | 'invalid' | 'not_found') { super('Provider operation rejected'); }
}
export class ProviderService {
  constructor(private readonly registry: ProviderRegistry, private readonly store: ProviderStore,private readonly requestContext:(providerId:string,context:ProviderContext)=>ProviderContext=(_id,context)=>context) {}
  catalog() { return this.registry.list().map(({ metadata, capabilities, limits, active }) => ({ metadata, capabilities, limits, active })); }
  list(context: WorkspaceContext) { return this.store.list(context); }
  private validate(providerId: string, environment: string, credentials: Credentials) {
    const descriptor = this.registry.describe(providerId);
    if (!descriptor?.active) throw new ProviderInputError('unavailable');
    const schema = descriptor.metadata.credentialSchema;
    if (!descriptor.metadata.environments.includes(environment) || Object.keys(credentials).some((key) => !schema.some((field) => field.key === key))
      || schema.some((field) => field.required && !credentials[field.key]?.trim())) throw new ProviderInputError('invalid');
    try {
      const adapter = this.registry.resolve(providerId);
      if (!adapter.validateCredentials(credentials, environment)) throw new Error('Invalid credentials');
      const identity = adapter.getExternalAgentId?.(credentials, environment);
      if (adapter.getExternalAgentId && (typeof identity !== 'string' || !identity.trim() || identity.length > 256)) throw new Error('Invalid identity');
      return identity;
    }
    catch { throw new ProviderInputError('invalid'); }
  }
  create(context: WorkspaceContext, input: { providerId: string; name: string; environment: string; credentials: Credentials }) {
    const identity = this.validate(input.providerId, input.environment, input.credentials);
    // The identity is server-derived; a body field must never choose ownership.
    return this.store.create(context, { providerId: input.providerId, name: input.name, environment: input.environment,
      credentials: input.credentials, ...(identity === undefined ? {} : { externalAgentId: identity }) });
  }
  async updateCredentials(context: WorkspaceContext, id: string, credentials: Credentials) {
    // Public connection metadata only; plaintext credentials are not loaded to validate replacement.
    const connection = (await this.store.list(context)).find((item) => item.id === id);
    if (!connection) throw new ProviderInputError('not_found');
    const identity = this.validate(connection.provider_id, connection.environment, credentials);
    if (connection.external_agent_id != null && connection.external_agent_id !== identity) throw new ProviderInputError('unavailable');
    if (!await this.store.updateCredentials(context, id, credentials, identity)) throw new ProviderInputError('not_found');
  }
  async testConnection(context: WorkspaceContext, id: string, signal: AbortSignal) {
    const loaded = await this.store.loadForProvider(context, id);
    if (!loaded) throw new ProviderInputError('not_found');
    if (loaded.connection.status === 'disabled') throw new ProviderInputError('unavailable');
    const identity = this.validate(loaded.connection.provider_id, loaded.connection.environment, loaded.credentials);
    if ((identity ?? null) !== loaded.connection.external_agent_id) throw new ProviderInputError('unavailable');
    const adapter = this.registry.resolve(loaded.connection.provider_id);
    const timeout = AbortSignal.timeout(8000);
    const operationSignal = AbortSignal.any([signal, timeout]);
    let status: 'connected' | 'disconnected' = 'disconnected';
    let error: CanonicalError | undefined;
    try {
      const result = await this.runConnectionTest(() => adapter.testConnection(this.requestContext(loaded.connection.provider_id,{ workspaceId: context.workspace_id, connectionId: id,
        environment: loaded.connection.environment, credentials: loaded.credentials, signal: operationSignal })), operationSignal);
      status = result.status === 'connected' ? 'connected' : 'disconnected';
      if (status === 'disconnected') {
        const code = result.error?.code;
        error = canonicalError(code && ['invalid_credentials', 'invalid_message', 'unsupported_capability', 'rate_limited', 'unavailable', 'rejected', 'unknown'].includes(code) ? code : 'unknown');
      }
    } catch { error = canonicalError('unavailable'); }
    // An abandoned request must not commit a result. A provider timeout can record a failed test.
    if (signal.aborted) throw new ProviderInputError('unavailable');
    if (!await this.store.recordConnectionTest(context, id, loaded.credentialVersion, status)) throw new ProviderInputError('unavailable');
    return { status, ...(error ? { error } : {}) };
  }
  private runConnectionTest<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Connection test cancelled'));
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  }
}
