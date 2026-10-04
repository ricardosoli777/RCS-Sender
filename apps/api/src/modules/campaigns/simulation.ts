import type { Pool,PoolClient } from 'pg';
import { processSimulationBatch } from '@rcs/database';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { transaction } from '../shared/infrastructure/transaction.js';
import { CampaignInputError,type Campaign,type CampaignStatus } from './contracts.js';
export type SimulationControl = 'pause' | 'resume' | 'cancel' | 'stop';
type Run = { id: string; campaign_id: string; mode: 'simulation'; message_version_id: string; not_before: Date | null; created_at: Date };
export type SimulationSnapshot = { campaign: Campaign; run: Run; counts: { total: number; pending: number; simulated: number; suppressed: number; cancelled: number }; automation: { status: string; attempts: number; available_at: Date } | null; realSending: false };
const columns = 'id,name,objective,status,revision,execution_mode,provider_connection_id,agent_id,audience_list_id,message_version_id,scheduled_at,created_at,updated_at';
export class CampaignSimulation {
  constructor(private readonly pool: Pool,private readonly now: () => number = Date.now) {}
  private async authorize(client: PoolClient,context: WorkspaceContext,write = false) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0];
    if (!member) throw new WorkspaceAccessError('not_found'); if (write && !['owner','admin','operator'].includes(member.role)) throw new WorkspaceAccessError('forbidden');
  }
  private async campaign(client: PoolClient,context: WorkspaceContext,id: string,expected?: number) {
    const campaign = (await client.query<Campaign>(`SELECT ${columns} FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[context.workspace_id,id])).rows[0];
    if (!campaign) throw new CampaignInputError('not_found'); if (expected !== undefined && (expected !== campaign.revision || campaign.revision >= 2147483647)) throw new CampaignInputError('conflict'); return campaign;
  }
  private async run(client: PoolClient,context: WorkspaceContext,id: string) {
    return (await client.query<Run>("SELECT id,campaign_id,mode,message_version_id,not_before,created_at FROM campaign_runs WHERE workspace_id=$1 AND campaign_id=$2 AND mode='simulation'",[context.workspace_id,id])).rows[0] ?? null;
  }
  private async snapshot(client: PoolClient,context: WorkspaceContext,campaign: Campaign,run: Run): Promise<SimulationSnapshot> {
    const counts = (await client.query<SimulationSnapshot['counts']>(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status='pending')::int AS pending,count(*) FILTER (WHERE status='simulated')::int AS simulated,count(*) FILTER (WHERE status='suppressed')::int AS suppressed,count(*) FILTER (WHERE status='cancelled')::int AS cancelled FROM campaign_recipients WHERE workspace_id=$1 AND run_id=$2`,[context.workspace_id,run.id])).rows[0]!;
    const automation = (await client.query<NonNullable<SimulationSnapshot['automation']>>('SELECT status,attempts,available_at FROM campaign_simulation_outbox WHERE workspace_id=$1 AND run_id=$2 ORDER BY expected_revision DESC LIMIT 1',[context.workspace_id,run.id])).rows[0] ?? null;
    return { campaign,run,counts,automation,realSending: false };
  }
  private async update(client: PoolClient,context: WorkspaceContext,id: string,status: CampaignStatus,event: string,metadata: object = {}) {
    const campaign = (await client.query<Campaign>(`UPDATE campaigns SET status=$3,revision=revision+1,updated_by_user_id=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${columns}`,[context.workspace_id,id,status,context.user_id])).rows[0]!;
    await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,$3,'campaign',$4,$5)",[context.workspace_id,context.user_id,event,id,JSON.stringify({ mode: 'simulation',revision: campaign.revision,status,...metadata })]); return campaign;
  }
  get(context: WorkspaceContext,id: string) {
    return transaction(this.pool,async (client) => { await this.authorize(client,context); const campaign = await this.campaign(client,context,id); const run = await this.run(client,context,id); return run ? this.snapshot(client,context,campaign,run) : null; });
  }
  prepare(context: WorkspaceContext,id: string,expectedRevision: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); const campaign = await this.campaign(client,context,id,expectedRevision);
      if (campaign.status !== 'draft' || campaign.execution_mode || !campaign.audience_list_id || !campaign.message_version_id) throw new CampaignInputError('conflict');
      const version = (await client.query<{ version: number; active_version: number | null; status: string }>(`SELECT v.version,m.active_version,m.status FROM message_versions v JOIN messages m ON m.workspace_id=v.workspace_id AND m.id=v.message_id WHERE v.workspace_id=$1 AND v.id=$2 FOR SHARE OF v,m`,[context.workspace_id,campaign.message_version_id])).rows[0];
      if (!version || version.status !== 'active' || version.version !== version.active_version) throw new CampaignInputError('conflict');
      if (campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() <= this.now()) throw new CampaignInputError('conflict');
      const audience = (await client.query<{ total: number; remaining: number }>(`SELECT count(*)::int AS total,count(*) FILTER (WHERE o.phone_normalized IS NULL)::int AS remaining FROM contact_list_members lm JOIN contacts c ON c.workspace_id=lm.workspace_id AND c.id=lm.contact_id LEFT JOIN opt_outs o ON o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized WHERE lm.workspace_id=$1 AND lm.list_id=$2`,[context.workspace_id,campaign.audience_list_id])).rows[0]!;
      if (!audience.remaining || audience.total > 5000) throw new CampaignInputError('conflict');
      const run = (await client.query<Run>(`INSERT INTO campaign_runs (workspace_id,campaign_id,mode,message_version_id,not_before) VALUES ($1,$2,'simulation',$3,$4) RETURNING id,campaign_id,mode,message_version_id,not_before,created_at`,[context.workspace_id,id,campaign.message_version_id,campaign.scheduled_at])).rows[0]!;
      await client.query(`INSERT INTO campaign_recipients (workspace_id,run_id,contact_id,phone_normalized,status) SELECT c.workspace_id,$3,c.id,c.phone_normalized,CASE WHEN o.phone_normalized IS NULL THEN 'pending' ELSE 'suppressed' END FROM contact_list_members lm JOIN contacts c ON c.workspace_id=lm.workspace_id AND c.id=lm.contact_id LEFT JOIN opt_outs o ON o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized WHERE lm.workspace_id=$1 AND lm.list_id=$2`,[context.workspace_id,campaign.audience_list_id,run.id]);
      await client.query("UPDATE campaigns SET execution_mode='simulation' WHERE workspace_id=$1 AND id=$2",[context.workspace_id,id]);
      const updated = await this.update(client,context,id,campaign.scheduled_at ? 'scheduled' : 'ready','campaign.simulation_prepared',{ audience: audience.total }); return this.snapshot(client,context,updated,run);
    });
  }
  step(context: WorkspaceContext,id: string,expectedRevision: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); const campaign = await this.campaign(client,context,id,expectedRevision); const run = await this.run(client,context,id);
      if (!run || campaign.execution_mode !== 'simulation' || !['ready','scheduled','running'].includes(campaign.status) || (run.not_before && new Date(run.not_before).getTime() > this.now())) throw new CampaignInputError('conflict');
      await client.query("UPDATE campaign_simulation_outbox SET status='discarded',updated_at=now() WHERE workspace_id=$1 AND run_id=$2 AND status='pending'",[context.workspace_id,run.id]);
      const { simulated,suppressed,pending } = await processSimulationBatch(client,context.workspace_id,run.id);
      const updated = await this.update(client,context,id,pending ? 'running' : 'completed','campaign.simulation_batch',{ simulated,suppressed }); return this.snapshot(client,context,updated,run);
    });
  }
  enqueue(context: WorkspaceContext,id: string,expectedRevision: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); const campaign = await this.campaign(client,context,id,expectedRevision); const run = await this.run(client,context,id);
      if (!run || campaign.execution_mode !== 'simulation' || !['ready','scheduled','running'].includes(campaign.status)) throw new CampaignInputError('conflict');
      if ((await client.query("SELECT id FROM campaign_simulation_outbox WHERE workspace_id=$1 AND run_id=$2 AND status='pending'",[context.workspace_id,run.id])).rowCount) throw new CampaignInputError('conflict');
      const updated = await this.update(client,context,id,campaign.status,'campaign.simulation_enqueued');
      await client.query('INSERT INTO campaign_simulation_outbox (workspace_id,run_id,actor_user_id,expected_revision,available_at) VALUES ($1,$2,$3,$4,$5)',[context.workspace_id,run.id,context.user_id,updated.revision,new Date(Math.max(this.now(),run.not_before ? new Date(run.not_before).getTime() : 0))]);
      return this.snapshot(client,context,updated,run);
    });
  }
  control(context: WorkspaceContext,id: string,expectedRevision: number,action: SimulationControl) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); const campaign = await this.campaign(client,context,id,expectedRevision); const run = await this.run(client,context,id);
      if (!run || campaign.execution_mode !== 'simulation') throw new CampaignInputError('conflict');
      let status: CampaignStatus;
      if (action === 'pause' && ['ready','scheduled','running'].includes(campaign.status)) status = 'paused';
      else if (action === 'resume' && campaign.status === 'paused') status = run.not_before && new Date(run.not_before).getTime() > this.now() ? 'scheduled' : 'ready';
      else if ((action === 'cancel' || action === 'stop') && ['ready','scheduled','running','paused'].includes(campaign.status)) {
        status = 'cancelled'; await client.query("UPDATE campaign_recipients SET status='cancelled',updated_at=now() WHERE workspace_id=$1 AND run_id=$2 AND status='pending'",[context.workspace_id,run.id]);
      } else throw new CampaignInputError('conflict');
      await client.query("UPDATE campaign_simulation_outbox SET status='discarded',updated_at=now() WHERE workspace_id=$1 AND run_id=$2 AND status='pending'",[context.workspace_id,run.id]);
      const updated = await this.update(client,context,id,status,`campaign.simulation_${action}`); return this.snapshot(client,context,updated,run);
    });
  }
}
