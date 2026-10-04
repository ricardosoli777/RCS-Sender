import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { transaction } from '../shared/infrastructure/transaction.js';
import { credentialVersion } from '../providers/infrastructure/credential-version.js';
import type { EligibilityContact, EligibilityResult, EligibilityStore } from './contracts.js';

export class PgEligibilityStore implements EligibilityStore {
  constructor(private readonly pool: Pool) {}
  private async authorize(client: PoolClient, context: WorkspaceContext) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE", [context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const membership = await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`, [context.workspace_id, context.user_id]);
    if (!membership.rowCount) throw new WorkspaceAccessError('not_found');
    if (!['owner','admin'].includes(membership.rows[0]!.role)) throw new WorkspaceAccessError('forbidden');
  }
  contact(context: WorkspaceContext, id: string) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      return (await client.query<EligibilityContact>(`SELECT c.id,c.phone_normalized AS phone,EXISTS(SELECT 1 FROM opt_outs o
        WHERE o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized) AS "optedOut"
        FROM contacts c WHERE c.workspace_id=$1 AND c.id=$2`, [context.workspace_id, id])).rows[0] ?? null;
    });
  }
  begin(context: WorkspaceContext, connectionId: string, contactId: string, expectedVersion: string, expectedPhone: string) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const current = (await client.query<{ revision: string; ciphertext: string }>(`SELECT EXTRACT(EPOCH FROM p.updated_at)::text AS revision,c.ciphertext
        FROM provider_connections p JOIN provider_credentials c ON c.workspace_id=p.workspace_id AND c.connection_id=p.id
        WHERE p.workspace_id=$1 AND p.id=$2 FOR UPDATE OF p,c`, [context.workspace_id,connectionId])).rows[0];
      if (!current || credentialVersion(current.ciphertext,current.revision) !== expectedVersion) return null;
      const contact = (await client.query<{ phone: string }>('SELECT phone_normalized AS phone FROM contacts WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [context.workspace_id,contactId])).rows[0];
      if (!contact || contact.phone !== expectedPhone) return null;
      const attemptId = randomUUID();
      await client.query(`INSERT INTO eligibility_checks (workspace_id,connection_id,contact_id,credential_version,attempt_id,status,reason,expires_at,phone_normalized,requested_by_user_id)
        VALUES ($1,$2,$3,$4,$5,'unknown','checking',now()+interval '5 minutes',$6,$7) ON CONFLICT (workspace_id,connection_id,contact_id) DO UPDATE
        SET credential_version=EXCLUDED.credential_version,attempt_id=EXCLUDED.attempt_id,status='unknown',reason='checking',checked_at=now(),expires_at=EXCLUDED.expires_at,phone_normalized=EXCLUDED.phone_normalized,requested_by_user_id=EXCLUDED.requested_by_user_id`,
      [context.workspace_id,connectionId,contactId,expectedVersion,attemptId,contact.phone,context.user_id]);
      await client.query(`INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata)
        VALUES ($1,$2,'eligibility.requested','contact',$3,$4)`, [context.workspace_id,context.user_id,contactId,JSON.stringify({ connectionId })]);
      return attemptId;
    });
  }
  save(context: WorkspaceContext, connectionId: string, contactId: string, expectedVersion: string, attemptId: string, result: Pick<EligibilityResult, 'status' | 'reason'>) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const connection = (await client.query<{ revision: string; status: string; ciphertext: string }>(`SELECT EXTRACT(EPOCH FROM p.updated_at)::text AS revision,p.status,c.ciphertext
        FROM provider_connections p JOIN provider_credentials c ON c.workspace_id=p.workspace_id AND c.connection_id=p.id
        WHERE p.workspace_id=$1 AND p.id=$2 FOR UPDATE OF p,c`, [context.workspace_id, connectionId])).rows[0];
      if (!connection || credentialVersion(connection.ciphertext, connection.revision) !== expectedVersion) return null;
      const contact = (await client.query<{ phone: string }>('SELECT phone_normalized AS phone FROM contacts WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [context.workspace_id, contactId])).rows[0];
      if (!contact) return null;
      const reserved = (await client.query<{ phone_normalized: string | null }>('SELECT phone_normalized FROM eligibility_checks WHERE workspace_id=$1 AND connection_id=$2 AND contact_id=$3 AND attempt_id=$4 FOR UPDATE',[context.workspace_id,connectionId,contactId,attemptId])).rows[0];
      if (!reserved) return null;
      const phoneChanged = reserved.phone_normalized !== contact.phone;
      const optedOut = (await client.query('SELECT 1 FROM opt_outs WHERE workspace_id=$1 AND phone_normalized=$2', [context.workspace_id, contact.phone])).rowCount;
      // A concurrent suppression always wins over a provider response.
      const status = optedOut ? 'blocked' : phoneChanged || connection.status !== 'connected' ? 'unknown' : result.status;
      const reason = optedOut ? 'opted_out' : phoneChanged ? 'contact_changed' : connection.status !== 'connected' ? 'connection_unavailable' : result.reason;
      const saved = (await client.query<EligibilityResult>(`UPDATE eligibility_checks SET status=$5,reason=$6,checked_at=now(),expires_at=now()+interval '5 minutes'
        WHERE workspace_id=$1 AND connection_id=$2 AND contact_id=$3 AND attempt_id=$4 AND reason='checking' AND credential_version=$7
        RETURNING status,reason,checked_at AS "checkedAt",expires_at AS "expiresAt"`, [context.workspace_id,connectionId,contactId,attemptId,status,reason,expectedVersion])).rows[0];
      if (!saved) return null;
      await client.query(`INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata)
        VALUES ($1,$2,'eligibility.checked','contact',$3,$4)`, [context.workspace_id,context.user_id,contactId,JSON.stringify({ connectionId,status,reason })]);
      return saved;
    });
  }
}
