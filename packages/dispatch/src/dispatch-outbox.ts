import {retryDelay} from '@rcs/database';
import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { WorkspaceContext } from './contracts.js';
import { WorkspaceAccessError } from './contracts.js';
import { transaction } from './transaction.js';
import { CampaignInputError } from './contracts.js';
import type { CampaignDispatch } from './dispatch.js';
export type DispatchJob = { id: string; workspace_id: string; attempts: number };
type Row = { id: string; workspace_id: string; run_id: string; campaign_id: string; contact_id: string; actor_user_id: string; expected_revision: number; status: string; attempts: number; available_at: Date; lease_until: Date | null };
type Claim = { row: Row; token: string; context: WorkspaceContext };

/** Durable orchestration shared by API enqueue and worker execution. */
export class CampaignDispatchOutbox {
  constructor(private readonly pool: Pool,private readonly dispatcher: Pick<CampaignDispatch,'dispatch'>,private readonly now: () => number = Date.now) {}
  private audit(client: PoolClient,row: Pick<Row,'workspace_id' | 'actor_user_id' | 'campaign_id' | 'id'>,event: string,metadata: object) {
    return client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,$3,'campaign',$4,$5)",[row.workspace_id,row.actor_user_id,event,row.campaign_id,JSON.stringify({ outboxId: row.id,...metadata })]);
  }
  private async role(client: PoolClient,workspaceId: string,userId: string) {
    return (await client.query<{ role: WorkspaceContext['role'] }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL AND m.role IN ('owner','admin','operator') FOR SHARE OF m,u`,[workspaceId,userId])).rows[0]?.role;
  }
  enqueue(context: WorkspaceContext,campaignId: string,expectedRevision: number,runId: string) {
    return transaction(this.pool,async (client) => {
      if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
      if (!await this.role(client,context.workspace_id,context.user_id)) throw new WorkspaceAccessError('forbidden');
      const campaign = (await client.query<{ revision: number; status: string; execution_mode: string }>('SELECT revision,status,execution_mode FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,campaignId])).rows[0];
      if (!campaign) throw new CampaignInputError('not_found');
      const run = (await client.query<{ not_before: Date | null }>(`SELECT r.not_before FROM campaign_dispatch_runs r JOIN campaign_dispatch_confirmations f ON f.workspace_id=r.workspace_id AND f.run_id=r.id WHERE r.workspace_id=$1 AND r.campaign_id=$2 AND r.id=$3`,[context.workspace_id,campaignId,runId])).rows[0];
      if (!run || campaign.revision !== expectedRevision || campaign.status !== 'ready' || campaign.execution_mode !== 'dispatch' || (await client.query('SELECT id FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND run_id=$2 LIMIT 1',[context.workspace_id,runId])).rowCount || (await client.query('SELECT id FROM campaign_dispatch_attempts WHERE workspace_id=$1 AND campaign_id=$2 LIMIT 1',[context.workspace_id,campaignId])).rowCount) throw new CampaignInputError('conflict');
      const revision = expectedRevision+1;
      const inserted = await client.query(`INSERT INTO campaign_dispatch_outbox (workspace_id,run_id,campaign_id,contact_id,actor_user_id,expected_revision,available_at) SELECT workspace_id,run_id,campaign_id,contact_id,$4,$5,$6 FROM campaign_dispatch_recipients WHERE workspace_id=$1 AND run_id=$2 AND campaign_id=$3 AND disposition='eligible' RETURNING id`,[context.workspace_id,runId,campaignId,context.user_id,revision,new Date(Math.max(this.now(),run.not_before ? new Date(run.not_before).getTime() : 0))]);
      if (!inserted.rowCount) throw new CampaignInputError('conflict');
      await client.query('UPDATE campaigns SET revision=$3,updated_by_user_id=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2',[context.workspace_id,campaignId,revision,context.user_id]);
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.dispatch_enqueued','campaign',$3,$4)",[context.workspace_id,context.user_id,campaignId,JSON.stringify({ runId,revision,recipients: inserted.rowCount })]);
      return { runId,revision,recipients: inserted.rowCount };
    });
  }
  async due(): Promise<DispatchJob[]> {
    return (await this.pool.query<DispatchJob>(`SELECT o.id,o.workspace_id,o.attempts FROM campaign_dispatch_outbox o JOIN campaigns c ON c.workspace_id=o.workspace_id AND c.id=o.campaign_id LEFT JOIN journey_enrollments e ON e.workspace_id=c.workspace_id AND e.id=c.journey_enrollment_id LEFT JOIN journeys j ON j.workspace_id=e.workspace_id AND j.id=e.journey_id WHERE ((o.status='pending' AND o.available_at<=$1 AND c.status<>'paused') OR (o.status='processing' AND o.lease_until<=$1)) AND (c.journey_enrollment_id IS NULL OR j.status<>'paused') ORDER BY COALESCE(o.lease_until,o.available_at),o.id LIMIT 20`,[new Date(this.now())])).rows;
  }
  control(context:WorkspaceContext,campaignId:string,expectedRevision:number,action:'pause'|'resume'|'stop') {
    return transaction(this.pool,async(client)=>{
      if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount)throw new WorkspaceAccessError('not_found');
      if (!await this.role(client,context.workspace_id,context.user_id))throw new WorkspaceAccessError('forbidden');
      const campaign=(await client.query<{revision:number;status:string;execution_mode:string;journey_enrollment_id:string|null}>('SELECT revision,status,execution_mode,journey_enrollment_id FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,campaignId])).rows[0];
      if (!campaign)throw new CampaignInputError('not_found');
      if(campaign.revision!==expectedRevision || campaign.execution_mode!=='dispatch' || campaign.journey_enrollment_id || !(await client.query('SELECT id FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND campaign_id=$2 LIMIT 1',[context.workspace_id,campaignId])).rowCount)throw new CampaignInputError('conflict');
      let status:string;
      if(action==='pause' && ['ready','queued','running'].includes(campaign.status))status='paused';
      else if(action==='resume' && campaign.status==='paused')status='ready';
      else if(action==='stop' && ['ready','queued','running','paused'].includes(campaign.status))status='cancelled';
      else throw new CampaignInputError('conflict');
      if(action==='resume' && !(await client.query("SELECT id FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND campaign_id=$2 AND status IN ('pending','processing') LIMIT 1",[context.workspace_id,campaignId])).rowCount) status=(await client.query("SELECT id FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND campaign_id=$2 AND status IN ('unresolved','dead') LIMIT 1",[context.workspace_id,campaignId])).rowCount?'failed':'completed';
      const revision=expectedRevision+1;
      await client.query('UPDATE campaigns SET status=$3,revision=$4,updated_by_user_id=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2',[context.workspace_id,campaignId,status,revision,context.user_id]);
      await client.query(`UPDATE campaign_dispatch_outbox o SET expected_revision=$3,status=$4,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND campaign_id=$2 AND status IN ('pending','processing') AND NOT EXISTS(SELECT 1 FROM campaign_dispatch_attempts a WHERE a.workspace_id=o.workspace_id AND a.campaign_id=o.campaign_id AND a.contact_id=o.contact_id)`,[context.workspace_id,campaignId,revision,action==='stop'?'discarded':'pending']);
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,$2,'campaign.dispatch_controlled','campaign',$3,$4)",[context.workspace_id,context.user_id,campaignId,JSON.stringify({action,status,revision})]);
      return {revision,status};
    });
  }
  private async ledger(client: PoolClient,row: Row) {
    return (await client.query<{ status: string }>('SELECT status FROM campaign_dispatch_attempts WHERE workspace_id=$1 AND campaign_id=$2 AND contact_id=$3',[row.workspace_id,row.campaign_id,row.contact_id])).rows[0]?.status;
  }
  private async finish(client: PoolClient,row: Row,status: string) {
    await client.query('UPDATE campaign_dispatch_outbox SET status=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.id,status]);
    if (!(await client.query("SELECT id FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND campaign_id=$2 AND status IN ('pending','processing') LIMIT 1",[row.workspace_id,row.campaign_id])).rowCount) {
      const incomplete=!!(await client.query("SELECT id FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND campaign_id=$2 AND status IN ('unresolved','dead') LIMIT 1",[row.workspace_id,row.campaign_id])).rowCount;
      const finalized=await client.query("UPDATE campaigns SET status=$3,revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status IN ('ready','queued','running') RETURNING id",[row.workspace_id,row.campaign_id,incomplete?'failed':'completed']);
      if(finalized.rowCount)await this.audit(client,row,'campaign.dispatch_finalized',{status:incomplete?'failed':'completed'});
    }
    await this.audit(client,row,'campaign.dispatch_job_finalized',{ status,attempts: row.attempts }); return status;
  }
  private claim(job: DispatchJob): Promise<Claim | string> {
    return transaction(this.pool,async (client) => {
      // Same workspace -> campaign -> outbox lock order as enqueue and dispatcher.
      if (!(await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[job.workspace_id])).rowCount) return 'ignored';
      const identity = (await client.query<{ campaign_id: string }>('SELECT campaign_id FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND id=$2',[job.workspace_id,job.id])).rows[0];
      if (!identity) return 'ignored';
      const campaign = (await client.query<{ revision: number; status: string; execution_mode: string; scheduled_at: Date | null }>('SELECT revision,status,execution_mode,scheduled_at FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[job.workspace_id,identity.campaign_id])).rows[0]!;
      const row = (await client.query<Row>('SELECT * FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[job.workspace_id,job.id])).rows[0]!;
      if (!['pending','processing'].includes(row.status) || row.attempts !== job.attempts || (row.status === 'pending' ? new Date(row.available_at).getTime() : new Date(row.lease_until!).getTime())>this.now()) return 'ignored';
      const ledger = await this.ledger(client,row);
      // A lease recovery only observes the durable attempt: it never sends again.
      if (ledger) return this.finish(client,row,['sending','unknown'].includes(ledger) ? 'unresolved' : 'completed');
      if (campaign.status==='paused') return 'ignored';
      const journey = (await client.query<{ status: string; enrollment_status: string }>(`SELECT j.status,e.status AS enrollment_status FROM campaigns c JOIN journey_enrollments e ON e.workspace_id=c.workspace_id AND e.id=c.journey_enrollment_id JOIN journeys j ON j.workspace_id=e.workspace_id AND j.id=e.journey_id WHERE c.workspace_id=$1 AND c.id=$2`,[row.workspace_id,row.campaign_id])).rows[0];
      if (journey?.status==='paused' && journey.enrollment_status==='waiting') return 'ignored';
      if (journey && (journey.status!=='active' || journey.enrollment_status!=='waiting')) return this.finish(client,row,'discarded');
      const role = await this.role(client,row.workspace_id,row.actor_user_id);
      const active = !!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active'",[row.workspace_id])).rowCount;
      const confirmed = !!(await client.query('SELECT run_id FROM campaign_dispatch_confirmations WHERE workspace_id=$1 AND run_id=$2',[row.workspace_id,row.run_id])).rowCount;
      if (!active || !role || !confirmed || campaign.revision !== row.expected_revision || campaign.execution_mode !== 'dispatch' || !['ready','queued','running'].includes(campaign.status)) return this.finish(client,row,'discarded');
      if (campaign.scheduled_at && new Date(campaign.scheduled_at).getTime()>this.now()) return 'ignored';
      if (row.attempts>=5) return this.finish(client,row,'dead');
      const connection=(await client.query<{id:string;dispatch_interval_ms:number}>(`SELECT p.id,p.dispatch_interval_ms FROM campaigns c JOIN provider_connections p ON p.workspace_id=c.workspace_id AND p.id=c.provider_connection_id WHERE c.workspace_id=$1 AND c.id=$2`,[row.workspace_id,row.campaign_id])).rows[0];
      if(!connection)return this.finish(client,row,'discarded');
      const window=(await client.query<{next_available_at:Date}>('SELECT next_available_at FROM connection_dispatch_windows WHERE workspace_id=$1 AND connection_id=$2 FOR UPDATE',[row.workspace_id,connection.id])).rows[0];
      if(window && new Date(window.next_available_at).getTime()>this.now()){await client.query('UPDATE campaign_dispatch_outbox SET available_at=$3 WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.id,window.next_available_at]);return 'pending';}
      await client.query('INSERT INTO connection_dispatch_windows(workspace_id,connection_id,next_available_at) VALUES($1,$2,$3) ON CONFLICT(workspace_id,connection_id) DO UPDATE SET next_available_at=EXCLUDED.next_available_at',[row.workspace_id,connection.id,new Date(this.now()+connection.dispatch_interval_ms)]);
      const token = randomUUID(); row.attempts++;
      await client.query("UPDATE campaign_dispatch_outbox SET status='processing',attempts=$3,lease_token=$4,lease_until=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2",[row.workspace_id,row.id,row.attempts,token,new Date(this.now()+30000)]);
      await this.audit(client,row,'campaign.dispatch_job_claimed',{ attempts: row.attempts });
      return { row,token,context: { workspace_id: row.workspace_id,user_id: row.actor_user_id,role,permissions: [] } };
    });
  }
  async execute(job: DispatchJob,signal: AbortSignal = new AbortController().signal): Promise<string> {
    if (signal.aborted) return 'ignored';
    const claimed = await this.claim(job); if (typeof claimed === 'string') return claimed;
    const { row,token,context } = claimed; let blocked = false;
    try { await this.dispatcher.dispatch(context,row.campaign_id,row.contact_id,row.expected_revision,signal); }
    catch (error) { blocked = error instanceof CampaignInputError || error instanceof WorkspaceAccessError; }
    // Result recording intentionally survives revoked actors and campaign changes.
    return transaction(this.pool,async (client) => {
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[row.workspace_id]);
      await client.query('SELECT id FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[row.workspace_id,row.campaign_id]);
      const current = (await client.query<{ lease_token: string; status: string }>('SELECT lease_token,status FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[row.workspace_id,row.id])).rows[0];
      if (current?.status !== 'processing' || current.lease_token !== token) return 'ignored';
      const ledger = await this.ledger(client,row);
      if (ledger) return this.finish(client,row,['sending','unknown'].includes(ledger) ? 'unresolved' : 'completed');
      if (blocked && !signal.aborted) return this.finish(client,row,'discarded');
      if (row.attempts>=5) return this.finish(client,row,'dead');
      // No ledger -> send could not start under the dispatch contract. Retry SQL only.
      await client.query("UPDATE campaign_dispatch_outbox SET status='pending',lease_token=NULL,lease_until=NULL,available_at=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2",[row.workspace_id,row.id,new Date(this.now()+retryDelay(`${row.workspace_id}:${row.id}`,row.attempts))]);
      await this.audit(client,row,'campaign.dispatch_job_retry',{ attempts: row.attempts }); return 'pending';
    });
  }
}
