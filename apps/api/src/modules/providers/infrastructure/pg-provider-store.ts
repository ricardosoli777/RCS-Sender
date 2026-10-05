import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { CredentialCipher } from '@rcs/security';
import type { Credentials } from '@rcs/providers';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../../workspaces/application/workspace-service.js';
import { transaction } from '../../shared/infrastructure/transaction.js';
import { ProviderBindingError, type CreateConnection, type LoadedProviderConnection, type ProviderConnection, type ProviderStore } from '../domain/contracts.js';
import { credentialVersion } from './credential-version.js';

const columns = 'id, workspace_id, provider_id, name, environment, status, external_agent_id, created_at, updated_at';
function assertAgentIdentity(identity: string | undefined) {
  if (identity !== undefined && (!identity.trim() || identity.length > 256)) throw new ProviderBindingError();
}
function boundCredentials(providerId: string,id: string,credentials: Credentials): Credentials {
  if(providerId!=='twilio')return credentials;
  const callback=new URL(credentials.webhookUrl!);
  callback.searchParams.set('connectionId',id);
  return {...credentials,webhookUrl:callback.href};
}
function rethrowBindingConflict(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505'
    && 'constraint' in error && error.constraint === 'provider_connections_agent_unique') throw new ProviderBindingError();
  throw error;
}
import { credentialContext } from '@rcs/dispatch';
export { credentialContext } from '@rcs/dispatch';
export class PgProviderStore implements ProviderStore {
  constructor(private readonly pool: Pool, private readonly cipher?: CredentialCipher) {}

  private async authorize(client: PoolClient, context: WorkspaceContext) {
    // The same workspace lock is used by membership mutations, avoiding stale-role writes.
    const workspace = await client.query("SELECT id FROM workspaces WHERE id = $1 AND status = 'active' FOR UPDATE", [context.workspace_id]);
    if (!workspace.rowCount) throw new WorkspaceAccessError('not_found');
    const member = await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active' AND u.status = 'active'
      AND u.disabled_at IS NULL FOR SHARE OF m, u`, [context.workspace_id, context.user_id]);
    if (!member.rowCount) throw new WorkspaceAccessError('not_found');
    if (!['owner', 'admin'].includes(member.rows[0]!.role)) throw new WorkspaceAccessError('forbidden');
  }
  list(context: WorkspaceContext): Promise<ProviderConnection[]> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      return (await client.query<ProviderConnection>(`SELECT ${columns} FROM provider_connections WHERE workspace_id = $1 ORDER BY created_at, id`, [context.workspace_id])).rows;
    });
  }
  create(context: WorkspaceContext, input: CreateConnection): Promise<ProviderConnection> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      if (!this.cipher) throw new Error('Criptografia de credenciais indisponível');
      assertAgentIdentity(input.externalAgentId);
      const connection = (await client.query<ProviderConnection>(`INSERT INTO provider_connections (id, workspace_id, provider_id, name, environment, external_agent_id)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${columns}`, [randomUUID(), context.workspace_id, input.providerId, input.name, input.environment, input.externalAgentId ?? null])).rows[0]!;
      const ciphertext = this.cipher.encrypt(JSON.stringify(boundCredentials(connection.provider_id,connection.id,input.credentials)), credentialContext(connection));
      await client.query('INSERT INTO provider_credentials (workspace_id, connection_id, ciphertext) VALUES ($1, $2, $3)', [context.workspace_id, connection.id, ciphertext]);
      await this.audit(client, context, connection.id, 'provider.connection_created');
      return connection;
    }).catch(rethrowBindingConflict);
  }
  updateCredentials(context: WorkspaceContext, id: string, credentials: Credentials, externalAgentId?: string): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const connection = (await client.query<ProviderConnection>(`SELECT ${columns} FROM provider_connections WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [context.workspace_id, id])).rows[0];
      if (!connection) return false;
      if (!this.cipher) throw new Error('Criptografia de credenciais indisponível');
      assertAgentIdentity(externalAgentId);
      // A bound connection cannot silently change agents or release an existing reservation.
      if (connection.external_agent_id !== null && connection.external_agent_id !== externalAgentId) throw new ProviderBindingError();
      const saved = await client.query('UPDATE provider_credentials SET ciphertext = $3, updated_at = now() WHERE workspace_id = $1 AND connection_id = $2',
        [context.workspace_id, id, this.cipher.encrypt(JSON.stringify(boundCredentials(connection.provider_id,id,credentials)), credentialContext(connection))]);
      if (saved.rowCount !== 1) throw new Error('Credenciais indisponíveis');
      await client.query("UPDATE provider_connections SET status = 'unverified', external_agent_id = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [context.workspace_id, id, externalAgentId ?? null]);
      await this.audit(client, context, id, 'provider.credentials_updated');
      return true;
    }).catch(rethrowBindingConflict);
  }
  loadForProvider(context: WorkspaceContext, id: string): Promise<LoadedProviderConnection | null> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const connection = (await client.query<ProviderConnection & { revision: string }>(`SELECT ${columns}, EXTRACT(EPOCH FROM updated_at)::text AS revision FROM provider_connections WHERE workspace_id = $1 AND id = $2`, [context.workspace_id, id])).rows[0];
      if (!connection) return null;
      if (!this.cipher) throw new Error('Criptografia de credenciais indisponível');
      const result = await client.query<{ ciphertext: string }>('SELECT ciphertext FROM provider_credentials WHERE workspace_id = $1 AND connection_id = $2', [context.workspace_id, id]);
      if (!result.rows[0]) throw new Error('Credenciais indisponíveis');
      const credentials: Credentials = JSON.parse(this.cipher.decrypt(result.rows[0].ciphertext, credentialContext(connection)));
      return { connection, credentials, credentialVersion: credentialVersion(result.rows[0].ciphertext, connection.revision) };
    });
  }
  recordConnectionTest(context: WorkspaceContext, id: string, expectedVersion: string, status: 'connected' | 'disconnected'): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const connection = (await client.query<ProviderConnection & { revision: string }>(`SELECT ${columns}, EXTRACT(EPOCH FROM updated_at)::text AS revision FROM provider_connections WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [context.workspace_id, id])).rows[0];
      if (!connection || connection.status === 'disabled') return false;
      const result = await client.query<{ ciphertext: string }>('SELECT ciphertext FROM provider_credentials WHERE workspace_id = $1 AND connection_id = $2 FOR UPDATE', [context.workspace_id, id]);
      if (!result.rows[0] || credentialVersion(result.rows[0].ciphertext, connection.revision) !== expectedVersion) return false;
      await client.query('UPDATE provider_connections SET status = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2', [context.workspace_id, id, status]);
      await this.audit(client, context, id, status === 'connected' ? 'provider.connected' : 'provider.connection_test_failed');
      return true;
    });
  }
  private audit(client: PoolClient, context: WorkspaceContext, id: string, event: string) {
    return client.query(`INSERT INTO audit_logs (workspace_id, actor_user_id, event, entity_type, entity_id)
      VALUES ($1, $2, $3, 'provider_connection', $4)`, [context.workspace_id, context.user_id, event, id]);
  }
}
