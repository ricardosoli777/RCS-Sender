import type { Credentials } from '@rcs/providers';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';
export type ProviderConnection = { id: string; workspace_id: string; provider_id: string; name: string; environment: string;
  status: 'unverified' | 'connected' | 'disconnected' | 'disabled'; created_at: Date; updated_at: Date };
export type CreateConnection = { providerId: string; name: string; environment: string; credentials: Credentials };
export interface ProviderStore {
  list(context: WorkspaceContext): Promise<ProviderConnection[]>;
  create(context: WorkspaceContext, input: CreateConnection): Promise<ProviderConnection>;
  updateCredentials(context: WorkspaceContext, id: string, credentials: Credentials): Promise<boolean>;
  loadForProvider(context: WorkspaceContext, id: string): Promise<{ connection: ProviderConnection; credentials: Credentials } | null>;
}
