import type { Pool,PoolClient } from 'pg';
import { validateMessage,type CanonicalMessage,type ProviderRegistry } from '@rcs/providers';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { transaction } from '../shared/infrastructure/transaction.js';
import { credentialVersion } from '../providers/infrastructure/credential-version.js';
import { CampaignInputError,type Campaign,type CampaignStatus } from './contracts.js';

type Run = { id: string; connection_id: string; message_version_id: string; audience_list_id: string; agent_id: string; credential_version: string; not_before: Date | null; prepared_revision: number };
export type DispatchPreparationSnapshot = { runId: string; campaignId: string; revision: number; status: CampaignStatus; confirmed: boolean; counts: { total: number; eligible: number; suppressed: number; unavailable: number }; executionAvailable: false };

/** Preparation API contract. Never creates jobs or invokes provider operations. */
export class CampaignDispatchPreparation {
  constructor(private readonly pool: Pool,private readonly registry: ProviderRegistry,private readonly now: () => number = Date.now) {}
  private async authorize(client: PoolClient,context: WorkspaceContext,write = true) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0];
    if (!member) throw new WorkspaceAccessError('not_found');
    if (write && !['owner','admin','operator'].includes(member.role)) throw new WorkspaceAccessError('forbidden');
  }
  private async campaign(client: PoolClient,context: WorkspaceContext,id: string,revision: number) {
    const campaign = (await client.query<Campaign>('SELECT * FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,id])).rows[0];
    if (!campaign) throw new CampaignInputError('not_found');
    if (campaign.revision !== revision) throw new CampaignInputError('conflict');
    return campaign;
  }
  private async connection(client: PoolClient,context: WorkspaceContext,campaign: Campaign) {
    const connection = (await client.query<{ provider_id: string; ciphertext: string; revision: string; external_agent_id: string }>(`SELECT p.provider_id,k.ciphertext,EXTRACT(EPOCH FROM p.updated_at)::text AS revision,p.external_agent_id FROM provider_connections p JOIN provider_credentials k ON k.workspace_id=p.workspace_id AND k.connection_id=p.id WHERE p.workspace_id=$1 AND p.id=$2 AND p.status='connected' FOR SHARE OF p,k`,[context.workspace_id,campaign.provider_connection_id])).rows[0];
    const descriptor = connection && this.registry.describe(connection.provider_id);
    if (!connection || !campaign.agent_id || connection.external_agent_id !== campaign.agent_id || !descriptor?.active || descriptor.capabilities.text !== 'supported' || descriptor.capabilities.eligibility !== 'supported') throw new CampaignInputError('conflict');
    const content = (await client.query<{ content: CanonicalMessage }>(`SELECT v.content FROM message_versions v JOIN messages m ON m.workspace_id=v.workspace_id AND m.id=v.message_id WHERE v.workspace_id=$1 AND v.id=$2 AND m.status='active' AND m.active_version=v.version FOR SHARE OF v,m`,[context.workspace_id,campaign.message_version_id])).rows[0]?.content;
    if (!content || validateMessage(content,descriptor.capabilities,descriptor.limits).length) throw new CampaignInputError('conflict');
    return credentialVersion(connection.ciphertext,connection.revision);
  }
  private async snapshot(client: PoolClient,context: WorkspaceContext,campaign: Campaign,runId: string): Promise<DispatchPreparationSnapshot> {
    const counts = (await client.query<DispatchPreparationSnapshot['counts']>(`SELECT count(*)::int AS total,count(*) FILTER (WHERE disposition='eligible')::int AS eligible,count(*) FILTER (WHERE disposition='suppressed')::int AS suppressed,count(*) FILTER (WHERE disposition='unavailable')::int AS unavailable FROM campaign_dispatch_recipients WHERE workspace_id=$1 AND run_id=$2`,[context.workspace_id,runId])).rows[0]!;
    const confirmed = !!(await client.query('SELECT run_id FROM campaign_dispatch_confirmations WHERE workspace_id=$1 AND run_id=$2',[context.workspace_id,runId])).rowCount;
    return { runId,campaignId: campaign.id,revision: campaign.revision,status: campaign.status,confirmed,counts,executionAvailable: false };
  }
  get(context: WorkspaceContext,id: string) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,false);
      const campaign = (await client.query<Campaign>('SELECT * FROM campaigns WHERE workspace_id=$1 AND id=$2',[context.workspace_id,id])).rows[0];
      if (!campaign) throw new CampaignInputError('not_found');
      const run = (await client.query<{ id: string }>('SELECT id FROM campaign_dispatch_runs WHERE workspace_id=$1 AND campaign_id=$2',[context.workspace_id,id])).rows[0];
      return run ? this.snapshot(client,context,campaign,run.id) : null;
    });
  }
  cancel(context: WorkspaceContext,id: string,expectedRevision: number,runId: string) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const campaign = await this.campaign(client,context,id,expectedRevision);
      const run = (await client.query<{ id: string }>('SELECT id FROM campaign_dispatch_runs WHERE workspace_id=$1 AND campaign_id=$2 AND id=$3',[context.workspace_id,id,runId])).rows[0];
      if (!run || campaign.execution_mode !== 'dispatch' || campaign.status !== 'ready' || (await client.query('SELECT id FROM campaign_dispatch_attempts WHERE workspace_id=$1 AND campaign_id=$2 LIMIT 1',[context.workspace_id,id])).rowCount) throw new CampaignInputError('conflict');
      const updated = (await client.query<Campaign>(`UPDATE campaigns SET status='cancelled',revision=revision+1,updated_by_user_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *`,[context.workspace_id,id,context.user_id])).rows[0]!;
      const discarded = await client.query("UPDATE campaign_dispatch_outbox SET status='discarded',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND campaign_id=$2 AND status IN ('pending','processing')",[context.workspace_id,id]);
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.dispatch_preparation_cancelled','campaign',$3,$4)",[context.workspace_id,context.user_id,id,JSON.stringify({ runId,revision: updated.revision,discardedJobs: discarded.rowCount })]);
      return this.snapshot(client,context,updated,runId);
    });
  }
  prepare(context: WorkspaceContext,id: string,expectedRevision: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const campaign = await this.campaign(client,context,id,expectedRevision);
      if (campaign.status !== 'draft' || campaign.execution_mode || !campaign.audience_list_id || !campaign.message_version_id || (campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() <= this.now())) throw new CampaignInputError('conflict');
      const version = await this.connection(client,context,campaign);
      // Serialize list membership edits and preserve one statement's complete audience.
      if (!(await client.query('SELECT id FROM contact_lists WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,campaign.audience_list_id])).rowCount) throw new CampaignInputError('conflict');
      const audience = (await client.query<{ id: string; phone: string; disposition: string }>(`SELECT c.id,c.phone_normalized AS phone,CASE WHEN EXISTS (SELECT 1 FROM opt_outs o WHERE o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized) THEN 'suppressed' WHEN e.status='eligible' AND e.reason='provider_checked' AND e.phone_normalized=c.phone_normalized AND e.credential_version=$4 AND e.expires_at>$5 THEN 'eligible' ELSE 'unavailable' END AS disposition FROM contact_list_members lm JOIN contacts c ON c.workspace_id=lm.workspace_id AND c.id=lm.contact_id LEFT JOIN eligibility_checks e ON e.workspace_id=c.workspace_id AND e.contact_id=c.id AND e.connection_id=$3 WHERE lm.workspace_id=$1 AND lm.list_id=$2 ORDER BY c.id LIMIT 5001 FOR SHARE OF c`,[context.workspace_id,campaign.audience_list_id,campaign.provider_connection_id,version,new Date(this.now())])).rows;
      if (audience.length>5000 || !audience.some((recipient) => recipient.disposition === 'eligible')) throw new CampaignInputError('conflict');
      const runId = (await client.query<{ id: string }>(`INSERT INTO campaign_dispatch_runs (workspace_id,campaign_id,connection_id,message_version_id,audience_list_id,agent_id,credential_version,not_before,prepared_by_user_id,prepared_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[context.workspace_id,id,campaign.provider_connection_id,campaign.message_version_id,campaign.audience_list_id,campaign.agent_id,version,campaign.scheduled_at,context.user_id,campaign.revision+1])).rows[0]!.id;
      await client.query(`INSERT INTO campaign_dispatch_recipients (workspace_id,run_id,campaign_id,contact_id,phone_normalized,disposition) SELECT $1,$2,$3,id,phone,disposition FROM jsonb_to_recordset($4::jsonb) AS recipients(id uuid,phone text,disposition text)`,[context.workspace_id,runId,id,JSON.stringify(audience)]);
      const updated = (await client.query<Campaign>(`UPDATE campaigns SET execution_mode='dispatch',status='ready',revision=revision+1,updated_by_user_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *`,[context.workspace_id,id,context.user_id])).rows[0]!;
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.dispatch_prepared','campaign',$3,$4)",[context.workspace_id,context.user_id,id,JSON.stringify({ runId,revision: updated.revision,audience: audience.length })]);
      return this.snapshot(client,context,updated,runId);
    });
  }
  confirm(context: WorkspaceContext,id: string,expectedRevision: number,runId: string,mode: 'dispatch') {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const campaign = await this.campaign(client,context,id,expectedRevision);
      const run = (await client.query<Run>('SELECT * FROM campaign_dispatch_runs WHERE workspace_id=$1 AND campaign_id=$2 AND id=$3',[context.workspace_id,id,runId])).rows[0];
      if (mode !== 'dispatch' || !run || campaign.execution_mode !== 'dispatch' || campaign.status !== 'ready' || campaign.revision !== run.prepared_revision || campaign.provider_connection_id !== run.connection_id || campaign.message_version_id !== run.message_version_id || campaign.audience_list_id !== run.audience_list_id || campaign.agent_id !== run.agent_id || (campaign.scheduled_at ? new Date(campaign.scheduled_at).getTime() : null) !== (run.not_before ? new Date(run.not_before).getTime() : null)) throw new CampaignInputError('conflict');
      if ((await client.query('SELECT run_id FROM campaign_dispatch_confirmations WHERE workspace_id=$1 AND run_id=$2',[context.workspace_id,runId])).rowCount || await this.connection(client,context,campaign) !== run.credential_version) throw new CampaignInputError('conflict');
      // Confirmation does not refresh eligibility; every dispatch still rechecks it.
      if (!(await client.query(`SELECT c.id FROM campaign_dispatch_recipients r JOIN contacts c ON c.workspace_id=r.workspace_id AND c.id=r.contact_id JOIN eligibility_checks e ON e.workspace_id=c.workspace_id AND e.contact_id=c.id AND e.connection_id=$3 WHERE r.workspace_id=$1 AND r.run_id=$2 AND r.disposition='eligible' AND c.phone_normalized=r.phone_normalized AND e.phone_normalized=r.phone_normalized AND e.credential_version=$4 AND e.status='eligible' AND e.reason='provider_checked' AND e.expires_at>$5 AND NOT EXISTS (SELECT 1 FROM opt_outs o WHERE o.workspace_id=c.workspace_id AND o.phone_normalized=r.phone_normalized) LIMIT 1 FOR SHARE OF c,e`,[context.workspace_id,runId,run.connection_id,run.credential_version,new Date(this.now())])).rowCount) throw new CampaignInputError('conflict');
      await client.query('INSERT INTO campaign_dispatch_confirmations (workspace_id,run_id,campaign_id,actor_user_id,campaign_revision) VALUES ($1,$2,$3,$4,$5)',[context.workspace_id,runId,id,context.user_id,campaign.revision+1]);
      const updated = (await client.query<Campaign>(`UPDATE campaigns SET revision=revision+1,updated_by_user_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *`,[context.workspace_id,id,context.user_id])).rows[0]!;
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.dispatch_confirmed','campaign',$3,$4)",[context.workspace_id,context.user_id,id,JSON.stringify({ runId,revision: updated.revision,mode })]);
      return this.snapshot(client,context,updated,runId);
    });
  }
}
