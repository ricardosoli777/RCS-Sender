import type { Pool, PoolClient } from 'pg';
import { ContactListInUseError } from './contracts.js';
import { transaction } from '../shared/infrastructure/transaction.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import type { Audience, Contact, ContactStore } from './contracts.js';

export class PgContactStore implements ContactStore {
  constructor(private readonly pool: Pool) {}
  private async authorize(client: PoolClient, context: WorkspaceContext, write = true) {
    const workspace = await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE", [context.workspace_id]);
    if (!workspace.rowCount) throw new WorkspaceAccessError('not_found');
    const member = await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`, [context.workspace_id, context.user_id]);
    if (!member.rowCount) throw new WorkspaceAccessError('not_found');
    if (write && !['owner', 'admin', 'operator'].includes(member.rows[0]!.role)) throw new WorkspaceAccessError('forbidden');
  }
  private audit(client: PoolClient, context: WorkspaceContext, event: string, id: string | null, metadata: object = {}) {
    return client.query(`INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata)
      VALUES ($1,$2,$3,'contacts',$4,$5)`, [context.workspace_id, context.user_id, event, id, JSON.stringify(metadata)]);
  }
  snapshot(context: WorkspaceContext, offset: number) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context, false);
      const contacts = await client.query<Contact>(`SELECT c.id,c.phone_normalized,c.name,EXISTS(SELECT 1 FROM opt_outs o
        WHERE o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized) AS opted_out FROM contacts c
        WHERE c.workspace_id=$1 ORDER BY c.created_at,c.id LIMIT 100 OFFSET $2`, [context.workspace_id, offset]);
      const lists = await client.query<Audience>(`SELECT l.id,l.name,count(m.contact_id)::int AS contact_count FROM contact_lists l
        LEFT JOIN contact_list_members m ON m.workspace_id=l.workspace_id AND m.list_id=l.id
        WHERE l.workspace_id=$1 GROUP BY l.id ORDER BY l.created_at,l.id`, [context.workspace_id]);
      const total = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM contacts WHERE workspace_id=$1', [context.workspace_id]);
      return { contacts: contacts.rows, lists: lists.rows, total: total.rows[0]!.total };
    });
  }
  import(context: WorkspaceContext, contacts: { phone: string; name: string }[], invalidRows: number[], listId?: string) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      if (listId && !(await client.query('SELECT id FROM contact_lists WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [context.workspace_id, listId])).rowCount) return null;
      const result = { created: 0, duplicates: 0, optedOut: 0, invalidRows };
      for (const contact of contacts) {
        if ((await client.query('SELECT 1 FROM opt_outs WHERE workspace_id=$1 AND phone_normalized=$2', [context.workspace_id, contact.phone])).rowCount) { result.optedOut++; continue; }
        const inserted = await client.query<{ id: string }>(`INSERT INTO contacts (workspace_id,phone_normalized,name) VALUES ($1,$2,$3)
          ON CONFLICT (workspace_id,phone_normalized) DO NOTHING RETURNING id`, [context.workspace_id, contact.phone, contact.name]);
        if (inserted.rowCount) result.created++; else result.duplicates++;
        if (listId) {
          const id = inserted.rows[0]?.id ?? (await client.query<{ id: string }>('SELECT id FROM contacts WHERE workspace_id=$1 AND phone_normalized=$2', [context.workspace_id, contact.phone])).rows[0]!.id;
          await client.query('INSERT INTO contact_list_members (workspace_id,list_id,contact_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [context.workspace_id, listId, id]);
        }
      }
      await this.audit(client, context, 'contacts.imported', listId ?? null, { created: result.created, duplicates: result.duplicates, optedOut: result.optedOut, invalid: invalidRows.length });
      return result;
    });
  }
  createList(context: WorkspaceContext, name: string) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const list = (await client.query<Audience>('INSERT INTO contact_lists (workspace_id,name) VALUES ($1,$2) RETURNING id,name,0 AS contact_count', [context.workspace_id, name])).rows[0]!;
      await this.audit(client, context, 'contacts.list_created', list.id); return list;
    });
  }
  deleteList(context: WorkspaceContext, id: string) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      if (!(await client.query('DELETE FROM contact_lists WHERE workspace_id=$1 AND id=$2', [context.workspace_id, id])).rowCount) return false;
      await this.audit(client, context, 'contacts.list_deleted', id); return true;
    }).catch((error: unknown) => {
      const databaseError = error as { code?: string; constraint?: string };
      if (databaseError?.code === '23503' && databaseError.constraint === 'campaigns_audience_list_fk') throw new ContactListInUseError();
      throw error;
    });
  }
  setOptOut(context: WorkspaceContext, id: string) {
    return transaction(this.pool, async (client) => {
      await this.authorize(client, context);
      const contact = (await client.query<{ phone_normalized: string }>('SELECT phone_normalized FROM contacts WHERE workspace_id=$1 AND id=$2', [context.workspace_id, id])).rows[0];
      if (!contact) return false;
      const inserted = await client.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2) ON CONFLICT DO NOTHING', [context.workspace_id, contact.phone_normalized]);
      if (inserted.rowCount) await this.audit(client, context, 'contacts.opted_out', id);
      return true;
    });
  }
}
