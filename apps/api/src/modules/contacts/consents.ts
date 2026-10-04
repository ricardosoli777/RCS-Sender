import type { Pool,PoolClient } from 'pg';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { transaction } from '../shared/infrastructure/transaction.js';
export const consentPurposes = ['marketing','transactional','authentication'] as const;
export const consentSources = ['manual_record','web_form','import_record','customer_request'] as const;
export type ConsentInput = { purpose: typeof consentPurposes[number]; state: 'granted' | 'revoked'; source: typeof consentSources[number]; evidenceReference: string; observedAt: string; expectedRevision: number; expectedPhone: string };
type ConsentSummary = { purpose: ConsentInput['purpose']; state: 'unknown' | ConsentInput['state']; revision: number; source: ConsentInput['source'] | null; observedAt: Date | null };
export class ConsentInputError extends Error { constructor(readonly reason: 'invalid' | 'not_found' | 'conflict') { super('Registro de consentimento indisponível.'); } }
export class ContactConsents {
  constructor(private readonly pool: Pool,private readonly now: () => number = Date.now) {}
  private async authorize(client: PoolClient,context: WorkspaceContext,write: boolean) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0];
    if (!member) throw new WorkspaceAccessError('not_found');
    if (write && !['owner','admin','operator'].includes(member.role)) throw new WorkspaceAccessError('forbidden');
  }
  private async contact(client: PoolClient,context: WorkspaceContext,id: string) {
    const contact = (await client.query<{ phone_normalized: string }>('SELECT phone_normalized FROM contacts WHERE workspace_id=$1 AND id=$2 FOR SHARE',[context.workspace_id,id])).rows[0];
    if (!contact) throw new ConsentInputError('not_found'); return contact;
  }
  private async snapshot(client: PoolClient,context: WorkspaceContext,id: string,phone: string) {
    const saved = (await client.query<ConsentSummary>(`SELECT DISTINCT ON (purpose) purpose,state,revision,source,observed_at AS "observedAt" FROM contact_rcs_consents WHERE workspace_id=$1 AND phone_normalized=$2 ORDER BY purpose,revision DESC`,[context.workspace_id,phone])).rows;
    const optedOut = !!(await client.query('SELECT 1 FROM opt_outs WHERE workspace_id=$1 AND phone_normalized=$2',[context.workspace_id,phone])).rowCount;
    return { contactId: id,phone,optedOut,consents: consentPurposes.map((purpose): ConsentSummary => saved.find((item) => item.purpose === purpose) ?? { purpose,state: 'unknown',revision: 0,source: null,observedAt: null }) };
  }
  get(context: WorkspaceContext,id: string) {
    return transaction(this.pool,async (client) => { await this.authorize(client,context,false); const contact = await this.contact(client,context,id); return this.snapshot(client,context,id,contact.phone_normalized); });
  }
  async record(context: WorkspaceContext,id: string,input: ConsentInput) {
    const date = new Date(input.observedAt);
    if (!consentPurposes.includes(input.purpose) || !['granted','revoked'].includes(input.state) || !consentSources.includes(input.source) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.evidenceReference) || !/^\+[1-9][0-9]{7,14}$/.test(input.expectedPhone) || !Number.isInteger(input.expectedRevision) || input.expectedRevision<0 || input.expectedRevision>=2147483647 || !Number.isFinite(date.getTime()) || date.toISOString() !== input.observedAt || date.getTime()>this.now()) throw new ConsentInputError('invalid');
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); const contact = await this.contact(client,context,id);
      if (contact.phone_normalized !== input.expectedPhone) throw new ConsentInputError('conflict');
      const previous = (await client.query<{ revision: number; observed_at: Date }>('SELECT revision,observed_at FROM contact_rcs_consents WHERE workspace_id=$1 AND phone_normalized=$2 AND purpose=$3 ORDER BY revision DESC LIMIT 1',[context.workspace_id,contact.phone_normalized,input.purpose])).rows[0];
      if ((previous?.revision ?? 0) !== input.expectedRevision || (previous && date.getTime()<new Date(previous.observed_at).getTime())) throw new ConsentInputError('conflict');
      const revision = input.expectedRevision+1;
      await client.query(`INSERT INTO contact_rcs_consents (workspace_id,contact_id,phone_normalized,purpose,revision,state,source,evidence_reference,observed_at,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[context.workspace_id,id,contact.phone_normalized,input.purpose,revision,input.state,input.source,input.evidenceReference,date,context.user_id]);
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'contacts.rcs_consent_recorded','contacts',$3,$4)",[context.workspace_id,context.user_id,id,JSON.stringify({ purpose: input.purpose,state: input.state,revision })]);
      return this.snapshot(client,context,id,contact.phone_normalized);
    });
  }
}
