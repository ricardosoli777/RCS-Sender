import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { CredentialCipher } from '@rcs/security';
import type { Credentials } from '@rcs/providers';
import type { WorkspaceContext } from '../../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../../workspaces/application/workspace-service.js';
import { transaction } from '../../shared/infrastructure/transaction.js';
import type { ProviderConnection, ProviderStore } from '../domain/contracts.js';

const columns = 'id, workspace_id, provider_id, name, environment, status, created_at, updated_at';
function credentialContext(connection: ProviderConnection) {
  return JSON.stringify(['provider-credentials-v1', connection.workspace_id, connection.id, connection.provider_id, connection.environment]);
}
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
  create(context: WorkspaceContext, input: { providerId: string; name: string; environment: string; credentials: Credentials }): Promise<ProviderConnection> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      if (!this.cipher) throw new Error('Criptografia de credenciais indisponível');
      const connection = (await client.query<ProviderConnection>(`INSERT INTO provider_connections (id, workspace_id, provider_id, name, environment)
        VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`, [randomUUID(), context.workspace_id, input.providerId, input.name, input.environment])).rows[0]!;
      const ciphertext = this.cipher.encrypt(JSON.stringify(input.credentials), credentialContext(connection));
      await client.query('INSERT INTO provider_credentials (workspace_id, connection_id, ciphertext) VALUES ($1, $2, $3)', [context.workspace_id, connection.id, ciphertext]);
      await this.audit(client, context, connection.id, 'provider.connection_created');
      return connection;
    });
  }
  updateCredentials(context: WorkspaceContext, id: string, credentials: Credentials): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const connection = (await client.query<ProviderConnection>(`SELECT ${columns} FROM provider_connections WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [context.workspace_id, id])).rows[0];
      if (!connection) return false;
      if (!this.cipher) throw new Error('Criptografia de credenciais indisponível');
      const saved = await client.query('UPDATE provider_credentials SET ciphertext = $3, updated_at = now() WHERE workspace_id = $1 AND connection_id = $2',
        [context.workspace_id, id, this.cipher.encrypt(JSON.stringify(credentials), credentialContext(connection))]);
      if (saved.rowCount !== 1) throw new Error('Credenciais indisponíveis');
      await client.query("UPDATE provider_connections SET status = 'unverified', updated_at = now() WHERE workspace_id = $1 AND id = $2", [context.workspace_id, id]);
      await this.audit(client, context, id, 'provider.credentials_updated');
      return true;
    });
  }
  loadForProvider(context: WorkspaceContext, id: string): Promise<{ connection: ProviderConnection; credentials: Credentials } | null> {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const connection = (await client.query<ProviderConnection>(`SELECT ${columns} FROM provider_connections WHERE workspace_id = $1 AND id = $2`, [context.workspace_id, id])).rows[0];
      if (!connection) return null;
      if (!this.cipher) throw new Error('Criptografia de credenciais indisponível');
      const result = await client.query<{ ciphertext: string }>('SELECT ciphertext FROM provider_credentials WHERE workspace_id = $1 AND connection_id = $2', [context.workspace_id, id]);
      if (!result.rows[0]) throw new Error('Credenciais indisponíveis');
      const credentials: Credentials = JSON.parse(this.cipher.decrypt(result.rows[0].ciphertext, credentialContext(connection)));
      return { connection, credentials };
    });
  }
  private audit(client: PoolClient, context: WorkspaceContext, id: string, event: string) {
    return client.query(`INSERT INTO audit_logs (workspace_id, actor_user_id, event, entity_type, entity_id)
      VALUES ($1, $2, $3, 'provider_connection', $4)`, [context.workspace_id, context.user_id, event, id]);
  }
}
