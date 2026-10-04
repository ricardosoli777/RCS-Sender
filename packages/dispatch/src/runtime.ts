import type { Pool } from 'pg';
import { ProviderRegistry } from '@rcs/providers';
import type { CredentialCipher } from '@rcs/security';
import { CampaignDispatch } from './dispatch.js';
import { CampaignDispatchOutbox,type DispatchJob } from './dispatch-outbox.js';
import { CampaignInputError,WorkspaceAccessError,type WorkspaceContext } from './contracts.js';
export const dispatchStatuses = ['pending','processing','completed','unresolved','discarded','dead'] as const;
export type DispatchSummary = { campaignId: string; revision: number; runId: string | null; executionAvailable: boolean; status:string; remoteEvidence:{delivered:number;read:number;failed:number;uncertainWithEvidence:number}; counts: Record<typeof dispatchStatuses[number],number> };

/** API and worker share this bootstrap. No default provider is registered here. */
export function createDispatchRuntime(pool: Pool,registry = new ProviderRegistry(),cipher?: CredentialCipher,now: () => number = Date.now,mediaOrigin?: string) {
  const supports = (providerId: string) => { const descriptor = registry.describe(providerId); return !!cipher && !!descriptor?.active && descriptor.capabilities.text === 'supported' && descriptor.capabilities.eligibility === 'supported'; };
  const available = () => registry.list().some((descriptor) => supports(descriptor.metadata.id));
  const outbox = new CampaignDispatchOutbox(pool,cipher ? new CampaignDispatch(pool,registry,cipher,now,mediaOrigin) : { dispatch: async () => { throw new CampaignInputError('conflict'); } },now);
  async function summary(context: WorkspaceContext,campaignId: string): Promise<DispatchSummary> {
    const result = (await pool.query<{ revision: number; status: string; execution_mode: string | null; connection_status: string | null; provider_id: string | null; run_id: string | null; confirmed: boolean }>(`SELECT c.revision,c.status,c.execution_mode,p.status AS connection_status,p.provider_id,r.id AS run_id,EXISTS(SELECT 1 FROM campaign_dispatch_confirmations f WHERE f.workspace_id=c.workspace_id AND f.run_id=r.id) AS confirmed
      FROM campaigns c JOIN workspaces w ON w.id=c.workspace_id AND w.status='active'
      JOIN workspace_members m ON m.workspace_id=c.workspace_id AND m.user_id=$3 AND m.status='active'
      JOIN users u ON u.id=m.user_id AND u.status='active' AND u.disabled_at IS NULL
      LEFT JOIN provider_connections p ON p.workspace_id=c.workspace_id AND p.id=c.provider_connection_id
      LEFT JOIN LATERAL (SELECT id FROM campaign_dispatch_runs WHERE workspace_id=c.workspace_id AND campaign_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
      WHERE c.workspace_id=$1 AND c.id=$2`,[context.workspace_id,campaignId,context.user_id])).rows[0];
    if (!result) throw new WorkspaceAccessError('not_found');
    const counts = Object.fromEntries(dispatchStatuses.map((status) => [status,0])) as DispatchSummary['counts'];
    if (result.run_id) for (const row of (await pool.query<{ status: keyof typeof counts; count: string }>('SELECT status,count(*)::text AS count FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND campaign_id=$2 AND run_id=$3 GROUP BY status',[context.workspace_id,campaignId,result.run_id])).rows) counts[row.status] = Number(row.count);
    const evidence=(await pool.query<{delivered:number;read:number;failed:number;uncertain:number}>(`SELECT count(DISTINCT a.id) FILTER(WHERE e.event_type='message.delivered')::int AS delivered,count(DISTINCT a.id) FILTER(WHERE e.event_type='message.read')::int AS read,count(DISTINCT a.id) FILTER(WHERE e.event_type='message.failed')::int AS failed,count(DISTINCT a.id) FILTER(WHERE a.status IN ('sending','unknown'))::int AS uncertain FROM campaign_dispatch_attempts a JOIN campaign_message_events e ON e.workspace_id=a.workspace_id AND e.attempt_id=a.id WHERE a.workspace_id=$1 AND a.campaign_id=$2`,[context.workspace_id,campaignId])).rows[0]!;
    return { campaignId,status:result.status,revision: result.revision,runId: result.run_id,executionAvailable: result.status === 'ready' && result.execution_mode === 'dispatch' && result.connection_status === 'connected' && result.confirmed && !!result.provider_id && supports(result.provider_id),counts,remoteEvidence:{delivered:evidence.delivered,read:evidence.read,failed:evidence.failed,uncertainWithEvidence:evidence.uncertain} };
  }
  return {
    available,
    control:(context:WorkspaceContext,id:string,revision:number,action:'pause'|'resume'|'stop')=>outbox.control(context,id,revision,action),
    summary,
    async enqueue(context: WorkspaceContext,campaignId: string,revision: number,runId: string) {
      const current = await summary(context,campaignId);
      if (!current.executionAvailable || current.runId !== runId || current.revision !== revision) throw new CampaignInputError('conflict');
      return outbox.enqueue(context,campaignId,revision,runId);
    },
    due: () => available() ? outbox.due() : Promise.resolve([]),
    async execute(job: DispatchJob,signal?: AbortSignal) {
      if (!available()) throw new CampaignInputError('conflict');
      return outbox.execute(job,signal);
    }
  };
}
export type DispatchRuntime = ReturnType<typeof createDispatchRuntime>;
