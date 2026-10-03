import { ProviderRegistry, type Credentials } from '@rcs/providers';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';
import type { ProviderStore } from '../domain/contracts.js';

export class ProviderInputError extends Error {
  constructor(readonly reason: 'unavailable' | 'invalid' | 'not_found') { super('Provider operation rejected'); }
}
export class ProviderService {
  constructor(private readonly registry: ProviderRegistry, private readonly store: ProviderStore) {}
  catalog() { return this.registry.list().map(({ metadata, capabilities, limits, active }) => ({ metadata, capabilities, limits, active })); }
  list(context: WorkspaceContext) { return this.store.list(context); }
  private validate(providerId: string, environment: string, credentials: Credentials) {
    const descriptor = this.registry.describe(providerId);
    if (!descriptor?.active) throw new ProviderInputError('unavailable');
    const schema = descriptor.metadata.credentialSchema;
    if (!descriptor.metadata.environments.includes(environment) || Object.keys(credentials).some((key) => !schema.some((field) => field.key === key))
      || schema.some((field) => field.required && !credentials[field.key]?.trim())) throw new ProviderInputError('invalid');
    try { if (!this.registry.resolve(providerId).validateCredentials(credentials, environment)) throw new Error('Invalid credentials'); }
    catch { throw new ProviderInputError('invalid'); }
  }
  create(context: WorkspaceContext, input: { providerId: string; name: string; environment: string; credentials: Credentials }) {
    this.validate(input.providerId, input.environment, input.credentials);
    return this.store.create(context, input);
  }
  async updateCredentials(context: WorkspaceContext, id: string, credentials: Credentials) {
    // Public connection metadata only; plaintext credentials are not loaded to validate replacement.
    const connection = (await this.store.list(context)).find((item) => item.id === id);
    if (!connection) throw new ProviderInputError('not_found');
    this.validate(connection.provider_id, connection.environment, credentials);
    if (!await this.store.updateCredentials(context, id, credentials)) throw new ProviderInputError('not_found');
  }
}
