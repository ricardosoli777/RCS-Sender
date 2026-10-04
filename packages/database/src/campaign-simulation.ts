import {retryDelay} from './retry-delay.js';
import type { Pool,PoolClient } from 'pg';

/** SQL-only simulation. No provider, credential or network messaging access. */
export async function processSimulationBatch(client: PoolClient,workspaceId: string,runId: string) {
  const batch = (await client.query<{ contact_id: string; opted_out: boolean }>(`SELECT r.contact_id,EXISTS (SELECT 1 FROM opt_outs o WHERE o.workspace_id=r.workspace_id AND o.phone_normalized=r.phone_normalized) AS opted_out FROM campaign_recipients r WHERE r.workspace_id=$1 AND r.run_id=$2 AND r.status='pending' ORDER BY r.contact_id LIMIT 50 FOR UPDATE OF r SKIP LOCKED`,[workspaceId,runId])).rows;
  let simulated = 0; let suppressed = 0;
  for (const row of batch) {
    if (row.opted_out) suppressed++; else simulated++;
    await client.query(`UPDATE campaign_recipients SET status=$4,simulation_result_id=$5,updated_at=now() WHERE workspace_id=$1 AND run_id=$2 AND contact_id=$3 AND status='pending'`,[workspaceId,runId,row.contact_id,row.opted_out ? 'suppressed' : 'simulated',row.opted_out ? null : `simulation-${runId}-${row.contact_id}`]);
  }
  const pending = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM campaign_recipients WHERE workspace_id=$1 AND run_id=$2 AND status='pending'",[workspaceId,runId])).rows[0]!.count;
  return { simulated,suppressed,pending };
}

export type SimulationJob = { id: string; workspace_id: string; attempts: number };
type OutboxRow = SimulationJob & { actor_user_id: string; run_id: string; expected_revision: number; status: string; available_at: Date };
export class SimulationOutbox {
  constructor(private readonly pool: Pool,private readonly now: () => number = Date.now) {}
  async due(): Promise<SimulationJob[]> {
    return (await this.pool.query<SimulationJob>("SELECT id,workspace_id,attempts FROM campaign_simulation_outbox WHERE status='pending' AND available_at <= $1 ORDER BY available_at,id LIMIT 20",[new Date(this.now())])).rows;
  }
  async execute(job: SimulationJob): Promise<'completed' | 'discarded' | 'ignored' | 'retry' | 'dead'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Same lock order as API mutations: workspace -> campaign -> outbox.
      const workspace = (await client.query<{ status: string }>('SELECT status FROM workspaces WHERE id=$1 FOR UPDATE',[job.workspace_id])).rows[0];
      const candidate = (await client.query<OutboxRow>('SELECT * FROM campaign_simulation_outbox WHERE workspace_id=$1 AND id=$2',[job.workspace_id,job.id])).rows[0];
      if (!candidate) { await client.query('COMMIT'); return 'ignored'; }
      const campaign = (await client.query<{ id: string; revision: number; status: string; execution_mode: string; not_before: Date | null }>(`SELECT c.id,c.revision,c.status,c.execution_mode,r.not_before FROM campaign_runs r JOIN campaigns c ON c.workspace_id=r.workspace_id AND c.id=r.campaign_id WHERE r.workspace_id=$1 AND r.id=$2 AND r.mode='simulation' FOR UPDATE OF c`,[job.workspace_id,candidate.run_id])).rows[0];
      const row = (await client.query<OutboxRow>('SELECT * FROM campaign_simulation_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[job.workspace_id,job.id])).rows[0]!;
      if (row.status !== 'pending' || row.attempts !== job.attempts || new Date(row.available_at).getTime() > this.now()) { await client.query('COMMIT'); return 'ignored'; }
      const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[job.workspace_id,row.actor_user_id])).rows[0];
      if (workspace?.status !== 'active' || !member || !['owner','admin','operator'].includes(member.role) || !campaign || campaign.execution_mode !== 'simulation' || !['ready','scheduled','running'].includes(campaign.status) || campaign.revision !== row.expected_revision || campaign.revision >= 2147483647) {
        await client.query("UPDATE campaign_simulation_outbox SET status='discarded',updated_at=now() WHERE workspace_id=$1 AND id=$2",[job.workspace_id,row.id]);
        await client.query('COMMIT'); return 'discarded';
      }
      if (campaign.not_before && new Date(campaign.not_before).getTime() > this.now()) { await client.query('COMMIT'); return 'ignored'; }
      const counts = await processSimulationBatch(client,job.workspace_id,row.run_id);
      const revision = campaign.revision+1; const status = counts.pending ? 'running' : 'completed';
      await client.query('UPDATE campaigns SET status=$3,revision=$4,updated_by_user_id=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2',[job.workspace_id,campaign.id,status,revision,row.actor_user_id]);
      await client.query("UPDATE campaign_simulation_outbox SET status='completed',updated_at=now() WHERE workspace_id=$1 AND id=$2",[job.workspace_id,row.id]);
      if (counts.pending) await client.query(`INSERT INTO campaign_simulation_outbox (workspace_id,run_id,actor_user_id,expected_revision,available_at) VALUES ($1,$2,$3,$4,$5)`,[job.workspace_id,row.run_id,row.actor_user_id,revision,new Date(this.now())]);
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.simulation_worker_batch','campaign',$3,$4)",[job.workspace_id,row.actor_user_id,campaign.id,JSON.stringify({ mode: 'simulation',revision,status,simulated: counts.simulated,suppressed: counts.suppressed })]);
      await client.query('COMMIT'); return 'completed';
    } catch {
      await client.query('ROLLBACK');
      // Only the matching attempt may advance retry state. An old delivery cannot
      // overwrite a successful retry or resurrect an invalidated command.
      const result = await client.query<{ status: string }>(`UPDATE campaign_simulation_outbox SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'dead' ELSE 'pending' END,available_at=$4::timestamptz,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND attempts=$3 AND status='pending' RETURNING status`,[job.workspace_id,job.id,job.attempts,new Date(this.now()+retryDelay(`${job.workspace_id}:${job.id}`,job.attempts+1))]);
      return result.rows[0]?.status === 'dead' ? 'dead' : result.rowCount ? 'retry' : 'ignored';
    } finally { client.release(); }
  }
}
