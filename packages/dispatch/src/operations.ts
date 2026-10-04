import type { Pool } from 'pg';
import { ProviderRegistry } from '@rcs/providers';
import { transaction } from './transaction.js';
import { JourneyService, JourneyInputError } from './journeys.js';
import type { WorkspaceContext } from './contracts.js';
export class OperationsService {
  private readonly auth: JourneyService;
  constructor(private readonly pool: Pool, private readonly now: () => number = Date.now) { this.auth=new JourneyService(pool,new ProviderRegistry()); }
  snapshot(context: WorkspaceContext) { return transaction(this.pool, async (client) => {
    await this.auth.authorize(client,context);
    const states: Record<string, unknown[]> = {};
    for (const [key,table] of [['receipts','webhook_receipts'],['dispatch','campaign_dispatch_outbox'],['entries','journey_entry_outbox'],['webhooks','journey_webhook_actions'],['enrollments','journey_enrollments']] as const) states[key]=(await client.query(`SELECT status,count(*)::int AS count FROM ${table} WHERE workspace_id=$1 GROUP BY status ORDER BY status`,[context.workspace_id])).rows;
    const failures=(await client.query('SELECT event_id,consumer,attempts,generation,available_at FROM event_consumer_failures f WHERE workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM event_consumptions c WHERE c.workspace_id=f.workspace_id AND c.event_id=f.event_id AND c.consumer=f.consumer) ORDER BY updated_at,event_id LIMIT 100',[context.workspace_id])).rows;
    const heartbeat=(await client.query<{ fresh: number; degraded: number }>("SELECT count(*) FILTER(WHERE last_seen_at>$1 AND status='healthy')::int AS fresh,count(*) FILTER(WHERE last_seen_at>$1 AND status='degraded')::int AS degraded FROM worker_heartbeats",[new Date(this.now()-30000)])).rows[0]!;
    return { states,failures,worker: heartbeat.fresh ? 'healthy' : heartbeat.degraded ? 'degraded' : 'unavailable',checkedAt:new Date(this.now()).toISOString() };
  }); }
  requeue(context: WorkspaceContext,eventId: string,consumer: string) { return transaction(this.pool,async (client) => {
    await this.auth.authorize(client,context,true); const owner=(await client.query("SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role='owner' AND status='active'",[context.workspace_id,context.user_id])).rowCount; if (!owner) throw new JourneyInputError('conflict');
    const result=await client.query('UPDATE event_consumer_failures f SET attempts=0,generation=generation+1,available_at=$4,updated_at=$4 WHERE workspace_id=$1 AND event_id=$2 AND consumer=$3 AND attempts=5 AND NOT EXISTS(SELECT 1 FROM event_consumptions c WHERE c.workspace_id=f.workspace_id AND c.event_id=f.event_id AND c.consumer=f.consumer) RETURNING generation',[context.workspace_id,eventId,consumer,new Date(this.now())]); if (!result.rowCount) throw new JourneyInputError('conflict');
    await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,$2,'event.consumer_requeued','canonical_event',$3,$4)",[context.workspace_id,context.user_id,eventId,JSON.stringify({ consumer,generation:result.rows[0].generation })]); return { requeued:true };
  }); }
}
