import type { Pool,PoolClient } from 'pg';
import { ProviderRegistry,validateMessage,type CanonicalMessage } from '@rcs/providers';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { transaction } from '../shared/infrastructure/transaction.js';
import { credentialVersion } from '../providers/infrastructure/credential-version.js';
import { readCachedEligibility } from './eligibility-review.js';
import { CampaignInputError,type Campaign,type CampaignDraft,type CampaignOption,type CampaignOptionKind,type CampaignReview,type CampaignStatus,type CampaignStore } from './contracts.js';
const columns = 'id,name,objective,status,revision,execution_mode,provider_connection_id,agent_id,audience_list_id,message_version_id,scheduled_at,created_at,updated_at';
export class PgCampaignStore implements CampaignStore {
  constructor(private readonly pool: Pool,private readonly registry = new ProviderRegistry(),private readonly now: () => number = Date.now) {}
  options(context: WorkspaceContext,kind: CampaignOptionKind,offset: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true);
      const sources = {
        connections: { select: 'c.id,c.name,c.status,c.external_agent_id AS "agentId"',from: 'provider_connections c',where: 'c.workspace_id=$1' },
        audiences: { select: 'c.id,c.name,(SELECT count(*)::int FROM contact_list_members lm WHERE lm.workspace_id=c.workspace_id AND lm.list_id=c.id) AS "contactCount"',from: 'contact_lists c',where: 'c.workspace_id=$1' },
        messages: { select: 'v.id,v.name,v.message_id AS "messageId",v.version',from: 'messages c JOIN message_versions v ON v.workspace_id=c.workspace_id AND v.message_id=c.id AND v.version=c.active_version',where: "c.workspace_id=$1 AND c.status='active'" }
      } as const;
      const source = sources[kind];
      const options = (await client.query<CampaignOption>(`SELECT ${source.select} FROM ${source.from} WHERE ${source.where} ORDER BY c.created_at,c.id LIMIT 50 OFFSET $2`,[context.workspace_id,offset])).rows;
      const total = (await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${source.from} WHERE ${source.where}`,[context.workspace_id])).rows[0]!.total;
      return { options,total };
    });
  }
  private async authorize(client: PoolClient,context: WorkspaceContext,write = false) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0];
    if (!member) throw new WorkspaceAccessError('not_found'); if (write && !['owner','admin','operator'].includes(member.role)) throw new WorkspaceAccessError('forbidden');
  }
  private async references(client: PoolClient,context: WorkspaceContext,input: CampaignDraft) {
    for (const [table,id] of [['provider_connections',input.providerConnectionId],['contact_lists',input.audienceListId],['message_versions',input.messageVersionId]] as const) {
      if (id && !(await client.query(`SELECT id FROM ${table} WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[context.workspace_id,id])).rowCount) throw new CampaignInputError('invalid');
    }
  }
  private audit(client: PoolClient,context: WorkspaceContext,campaign: Campaign,event: string) {
    return client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,$3,'campaign',$4,$5)",[context.workspace_id,context.user_id,event,campaign.id,JSON.stringify({ revision: campaign.revision,status: campaign.status })]);
  }
  private async locked(client: PoolClient,context: WorkspaceContext,id: string,expected: number) {
    const row = (await client.query<Campaign>(`SELECT ${columns} FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[context.workspace_id,id])).rows[0];
    if (!row) throw new CampaignInputError('not_found'); if (row.status !== 'draft' || row.revision !== expected || row.revision >= 2147483647) throw new CampaignInputError('conflict'); return row;
  }
  create(context: WorkspaceContext,input: CampaignDraft) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); await this.references(client,context,input);
      const row = (await client.query<Campaign>(`INSERT INTO campaigns (workspace_id,name,objective,provider_connection_id,agent_id,audience_list_id,message_version_id,scheduled_at,created_by_user_id,updated_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${columns}`,[context.workspace_id,input.name,input.objective,input.providerConnectionId,input.agentId,input.audienceListId,input.messageVersionId,input.scheduledAt,context.user_id])).rows[0]!;
      await this.audit(client,context,row,'campaign.created'); return row;
    });
  }
  revise(context: WorkspaceContext,id: string,expectedRevision: number,input: CampaignDraft) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); await this.locked(client,context,id,expectedRevision); await this.references(client,context,input);
      const row = (await client.query<Campaign>(`UPDATE campaigns SET name=$3,objective=$4,provider_connection_id=$5,agent_id=$6,audience_list_id=$7,message_version_id=$8,scheduled_at=$9,revision=revision+1,updated_by_user_id=$10,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${columns}`,[context.workspace_id,id,input.name,input.objective,input.providerConnectionId,input.agentId,input.audienceListId,input.messageVersionId,input.scheduledAt,context.user_id])).rows[0]!;
      await this.audit(client,context,row,'campaign.revised'); return row;
    });
  }
  cancel(context: WorkspaceContext,id: string,expectedRevision: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); await this.locked(client,context,id,expectedRevision);
      const row = (await client.query<Campaign>(`UPDATE campaigns SET status='cancelled',revision=revision+1,updated_by_user_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${columns}`,[context.workspace_id,id,context.user_id])).rows[0]!;
      await this.audit(client,context,row,'campaign.cancelled'); return row;
    });
  }
  list(context: WorkspaceContext,offset: number,status?: CampaignStatus) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const campaigns = (await client.query<Campaign>(`SELECT ${columns} FROM campaigns WHERE workspace_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at,id LIMIT 50 OFFSET $3`,[context.workspace_id,status ?? null,offset])).rows;
      const total = (await client.query<{ total: number }>('SELECT count(*)::int AS total FROM campaigns WHERE workspace_id=$1 AND ($2::text IS NULL OR status=$2)',[context.workspace_id,status ?? null])).rows[0]!.total; return { campaigns,total };
    });
  }
  get(context: WorkspaceContext,id: string) { return transaction(this.pool,async (client) => { await this.authorize(client,context); return (await client.query<Campaign>(`SELECT ${columns} FROM campaigns WHERE workspace_id=$1 AND id=$2`,[context.workspace_id,id])).rows[0] ?? null; }); }
  review(context: WorkspaceContext,id: string): Promise<CampaignReview> {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const campaign = (await client.query<Campaign>(`SELECT ${columns} FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[context.workspace_id,id])).rows[0]; if (!campaign) throw new CampaignInputError('not_found');
      const issues: string[] = []; if (campaign.status !== 'draft') issues.push('campaign_not_draft');
      if (!campaign.agent_id) issues.push('agent_missing');
      const connection = campaign.provider_connection_id ? (await client.query<{ provider_id: string; status: string; external_agent_id: string | null; revision: string; ciphertext: string | null }>('SELECT p.provider_id,p.status,p.external_agent_id,EXTRACT(EPOCH FROM p.updated_at)::text AS revision,k.ciphertext FROM provider_connections p LEFT JOIN provider_credentials k ON k.workspace_id=p.workspace_id AND k.connection_id=p.id WHERE p.workspace_id=$1 AND p.id=$2 FOR SHARE OF p',[context.workspace_id,campaign.provider_connection_id])).rows[0] : null;
      if (!connection) issues.push('provider_missing'); else if (connection.status !== 'connected') issues.push('connection_not_verified');
      if (connection?.external_agent_id && campaign.agent_id !== connection.external_agent_id) issues.push('agent_binding_mismatch');
      if (connection && !connection.external_agent_id) issues.push('agent_binding_missing');
      if (connection && !connection.ciphertext) issues.push('provider_credentials_missing');
      const descriptor = connection ? this.registry.describe(connection.provider_id) : null;
      if (connection && !descriptor?.active) issues.push('provider_inactive');
      const version = campaign.message_version_id ? (await client.query<{ id: string; message_id: string; version: number; content: CanonicalMessage; status: string; active_version: number | null }>('SELECT v.id,v.message_id,v.version,v.content,m.status,m.active_version FROM message_versions v JOIN messages m ON m.workspace_id=v.workspace_id AND m.id=v.message_id WHERE v.workspace_id=$1 AND v.id=$2 FOR SHARE OF v,m',[context.workspace_id,campaign.message_version_id])).rows[0] : null;
      if (!version) issues.push('message_missing'); else {
        if (version.status !== 'active' || version.active_version !== version.version) issues.push('message_version_not_active');
        if (descriptor) issues.push(...validateMessage(version.content,descriptor.capabilities,descriptor.limits).map((issue) => `message_${issue}`));
        const count = (version.content.suggestions?.length ?? 0)+(version.content.type === 'rich_card' ? version.content.card.suggestions?.length ?? 0 : 0);
        if (descriptor?.limits.maxSuggestions !== undefined && count > descriptor.limits.maxSuggestions) issues.push('message_suggestion_limit');
      }
      if (!campaign.audience_list_id) issues.push('audience_missing');
      const audience = (await client.query<{ total: number; opted_out: number }>(`SELECT count(*)::int AS total,count(o.phone_normalized)::int AS opted_out FROM contact_list_members lm JOIN contacts c ON c.workspace_id=lm.workspace_id AND c.id=lm.contact_id LEFT JOIN opt_outs o ON o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized WHERE lm.workspace_id=$1 AND lm.list_id=$2`,[context.workspace_id,campaign.audience_list_id])).rows[0]!;
      if (!audience.total) issues.push('audience_empty'); else if (audience.total === audience.opted_out) issues.push('audience_fully_opted_out');
      const checkedAt = this.now();
      const currentVersion = connection?.status === 'connected' && connection.ciphertext ? credentialVersion(connection.ciphertext,connection.revision) : null;
      const eligibility = await readCachedEligibility(client,context.workspace_id,campaign.audience_list_id,campaign.provider_connection_id,currentVersion,!!descriptor?.active && descriptor.capabilities.eligibility === 'supported',checkedAt);
      if (eligibility.unchecked) issues.push('eligibility_unchecked'); if (eligibility.stale) issues.push('eligibility_stale'); if (eligibility.unknown) issues.push('eligibility_unknown'); if (eligibility.ineligible) issues.push('eligibility_ineligible');
      if (audience.total && !eligibility.eligible) issues.push('audience_no_cached_eligible');
      if (campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() <= checkedAt) issues.push('schedule_in_past');
      issues.push('runtime_not_available');
      return { campaign,audience: { total: audience.total,optedOut: audience.opted_out,remaining: audience.total-audience.opted_out },eligibility: { source: 'saved_checks',checkedAt: new Date(checkedAt),counts: eligibility },message: version ? { id: version.id,message_id: version.message_id,version: version.version } : null,issues: [...new Set(issues)],executionAvailable: false };
    });
  }
}
