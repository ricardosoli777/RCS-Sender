import type { Credentials } from '@rcs/providers';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';
export type ProviderConnection = { id: string; workspace_id: string; provider_id: string; name: string; environment: string;
  status: 'unverified' | 'connected' | 'disconnected' | 'disabled'; external_agent_id: string | null; created_at: Date; updated_at: Date };
export type CreateConnection = { providerId: string; name: string; environment: string; credentials: Credentials; externalAgentId?: string };
export type LoadedProviderConnection = { connection: ProviderConnection; credentials: Credentials; credentialVersion: string };
export class ProviderBindingError extends Error {
  constructor() { super('Vínculo de agente indisponível.'); }
}
export interface ProviderStore {
  list(context: WorkspaceContext): Promise<ProviderConnection[]>;
  create(context: WorkspaceContext, input: CreateConnection): Promise<ProviderConnection>;
  updateCredentials(context: WorkspaceContext, id: string, credentials: Credentials, externalAgentId?: string): Promise<boolean>;
  loadForProvider(context: WorkspaceContext, id: string): Promise<LoadedProviderConnection | null>;
  recordConnectionTest(context: WorkspaceContext, id: string, credentialVersion: string, status: 'connected' | 'disconnected'): Promise<boolean>;
}
