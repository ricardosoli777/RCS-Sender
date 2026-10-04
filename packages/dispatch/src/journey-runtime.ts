import type { Pool,PoolClient } from 'pg';
import { validateMessage,type CanonicalMessage,type ProviderRegistry } from '@rcs/providers';
import { credentialVersion } from './credentials.js';
import { transaction } from './transaction.js';
import type { WorkspaceContext } from './contracts.js';
import { EventBus,type EventJob } from './events.js';
import { JourneyService,JourneyInputError } from './journeys.js';
import { evaluateCondition,scoreClassification } from './journey-conditions.js';
import type { JourneyGraph } from './journey-graph.js';
import type { WebhookActions } from './webhook-actions.js';
import { JourneyEntries } from './journey-entries.js';
export type JourneyJob = { enrollment_id: string; workspace_id: string; revision: number };
export type Enrollment = { id: string; workspace_id: string; journey_id: string; version_id: string; contact_id: string; phone_normalized: string; actor_user_id: string; status: string; current_node_id: string; revision: number; wake_at: Date | null; context: Record<string,unknown>; entered_at: Date };
/** Executes one generation under SQL locks. External actions use separate durable intents. */
export class JourneyRuntime {
  private readonly journeys: JourneyService;
  constructor(private readonly pool: Pool,private readonly registry: ProviderRegistry,private readonly events: EventBus,private readonly now: () => number = Date.now,private readonly webhooks?: WebhookActions) { this.journeys = new JourneyService(pool,registry); }
  available() { return this.events.readyForDomainEvents(); }
  enroll(context: WorkspaceContext,journeyId: string,contactId: string,source: 'manual' | 'contact_list' | 'campaign' | 'tag_added' | 'API_event' = 'manual') {
    if (!this.available()) return Promise.reject(new JourneyInputError('conflict'));
    return transaction(this.pool,async (client) => {
      await this.journeys.authorize(client,context,true);
      const version = (await client.query<{ id: string; graph: JourneyGraph }>(`SELECT v.id,v.graph FROM journeys j JOIN journey_versions v ON v.workspace_id=j.workspace_id AND v.journey_id=j.id AND v.version=j.published_version WHERE j.workspace_id=$1 AND j.id=$2 AND j.status='active' FOR UPDATE OF j`,[context.workspace_id,journeyId])).rows[0];
      const contact = (await client.query<{ phone_normalized: string }>('SELECT phone_normalized FROM contacts WHERE workspace_id=$1 AND id=$2 FOR SHARE',[context.workspace_id,contactId])).rows[0];
      if (!version || !contact || (await client.query('SELECT workspace_id FROM opt_outs WHERE workspace_id=$1 AND phone_normalized=$2',[context.workspace_id,contact.phone_normalized])).rowCount) throw new JourneyInputError('conflict');
      const start = version.graph.nodes.find((node) => node.type==='start')!;
      const policy=(await client.query<{ duplicate_policy: string }>('SELECT duplicate_policy FROM journey_entry_rules WHERE workspace_id=$1 AND journey_id=$2',[context.workspace_id,journeyId])).rows[0]?.duplicate_policy;
      if (policy==='prevent_any_duplicate' && (await client.query('SELECT id FROM journey_enrollments WHERE workspace_id=$1 AND journey_id=$2 AND contact_id=$3',[context.workspace_id,journeyId,contactId])).rowCount) throw new JourneyInputError('conflict');
      const result = await client.query<Enrollment>(`INSERT INTO journey_enrollments(workspace_id,journey_id,version_id,contact_id,phone_normalized,actor_user_id,entry_source,current_node_id,wake_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,journey_id,contact_id) WHERE status IN ('active','waiting') DO NOTHING RETURNING *`,[context.workspace_id,journeyId,version.id,contactId,contact.phone_normalized,context.user_id,source,start.id,new Date(this.now())]);
      if (!result.rowCount) throw new JourneyInputError('conflict'); const enrollment = result.rows[0]!;
      await this.events.publishDomain(client,context.workspace_id,'journey.entered',contactId,enrollment.id,{ journeyId,versionId: version.id,source });
      await this.audit(client,enrollment,'journey.enrolled',{ journeyId,versionId: version.id }); return this.summary(enrollment);
    });
  }
  private summary(row: Enrollment) { return { id: row.id,journeyId: row.journey_id,versionId: row.version_id,contactId: row.contact_id,status: row.status,nodeId: row.current_node_id,revision: row.revision,wakeAt: row.wake_at }; }
  list(context: WorkspaceContext,journeyId: string,offset = 0) {
    return transaction(this.pool,async (client) => { await this.journeys.authorize(client,context); const exists = await client.query('SELECT id FROM journeys WHERE workspace_id=$1 AND id=$2',[context.workspace_id,journeyId]); if (!exists.rowCount) throw new JourneyInputError('not_found'); const rows = (await client.query<Enrollment>('SELECT * FROM journey_enrollments WHERE workspace_id=$1 AND journey_id=$2 ORDER BY entered_at DESC,id LIMIT 50 OFFSET $3',[context.workspace_id,journeyId,offset])).rows; return { enrollments: rows.map((row) => this.summary(row)),total: (await client.query<{ total: number }>('SELECT count(*)::int AS total FROM journey_enrollments WHERE workspace_id=$1 AND journey_id=$2',[context.workspace_id,journeyId])).rows[0]!.total }; });
  }
  async due(): Promise<JourneyJob[]> { if (!this.available()) return []; return (await this.pool.query<JourneyJob>(`SELECT e.id AS enrollment_id,e.workspace_id,e.revision FROM journey_enrollments e JOIN journeys j ON j.workspace_id=e.workspace_id AND j.id=e.journey_id AND j.status IN ('active','archived') JOIN workspaces w ON w.id=e.workspace_id AND w.status='active' WHERE e.status IN ('active','waiting') AND e.wake_at<=$1 ORDER BY e.wake_at,e.id LIMIT 20`,[new Date(this.now())])).rows; }
  private audit(client: PoolClient,row: Enrollment,event: string,metadata: object) { return client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,$2,$3,'journey_enrollment',$4,$5)",[row.workspace_id,row.actor_user_id,event,row.id,JSON.stringify(metadata)]); }
  private async transition(client: PoolClient,row: Enrollment,status: string,nodeId: string,outcome: string,wakeAt: Date | null,context = row.context) {
    const terminal = ['completed','converted','stopped','opted_out','failed'].includes(status);
    await client.query('INSERT INTO journey_transitions(workspace_id,enrollment_id,revision,node_id,outcome,next_node_id) VALUES($1,$2,$3,$4,$5,$6)',[row.workspace_id,row.id,row.revision,row.current_node_id,outcome,terminal ? null : nodeId]);
    await client.query('UPDATE journey_enrollments SET status=$3,current_node_id=$4,revision=revision+1,wake_at=$5,context=$6,last_activity_at=now(),completed_at=$7,error_code=$8 WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.id,status,nodeId,wakeAt,JSON.stringify(context),terminal ? new Date(this.now()) : null,status==='failed' ? outcome : null]);
    await this.audit(client,row,'journey.transition',{ nodeId: row.current_node_id,nextNodeId: terminal ? null : nodeId,outcome,status,revision: row.revision+1 });
    if (!['wait_scheduled','event_wait_scheduled','message_queued','webhook_queued'].includes(outcome)) await this.events.publishDomain(client,row.workspace_id,'journey.node_completed',row.contact_id,row.id,{ nodeId: row.current_node_id,outcome });
    if (status==='completed') await this.events.publishDomain(client,row.workspace_id,'journey.completed',row.contact_id,row.id,{ journeyId: row.journey_id });
    return status;
  }
  execute(job: JourneyJob) {
    return transaction(this.pool,async (client) => {
      const workspace = await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[job.workspace_id]); if (!workspace.rowCount) return 'ignored';
      const row = (await client.query<Enrollment>('SELECT * FROM journey_enrollments WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[job.workspace_id,job.enrollment_id])).rows[0];
      if (!row || row.revision!==job.revision || !['active','waiting'].includes(row.status) || !row.wake_at || new Date(row.wake_at).getTime()>this.now()) return 'ignored';
      const journey = (await client.query<{ status: string }>('SELECT status FROM journeys WHERE workspace_id=$1 AND id=$2 FOR SHARE',[row.workspace_id,row.journey_id])).rows[0]!;
      if (journey.status==='archived') return this.transition(client,row,'stopped',row.current_node_id,'journey_archived',null); if (journey.status!=='active') return 'ignored';
      const actor = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id AND u.status='active' AND u.disabled_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' FOR SHARE OF m,u`,[row.workspace_id,row.actor_user_id])).rows[0];
      if (!actor || !['owner','admin','operator'].includes(actor.role)) return this.transition(client,row,'stopped',row.current_node_id,'actor_revoked',null);
      const contact = (await client.query<{ phone_normalized: string; name: string }>('SELECT phone_normalized,name FROM contacts WHERE workspace_id=$1 AND id=$2 FOR SHARE',[row.workspace_id,row.contact_id])).rows[0]!;
      if (contact.phone_normalized!==row.phone_normalized) return this.transition(client,row,'failed',row.current_node_id,'contact_changed',null);
      if ((await client.query('SELECT workspace_id FROM opt_outs WHERE workspace_id=$1 AND phone_normalized=$2',[row.workspace_id,row.phone_normalized])).rowCount) return this.transition(client,row,'opted_out',row.current_node_id,'opt_out',null);
      const graph = (await client.query<{ graph: JourneyGraph }>('SELECT graph FROM journey_versions WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.version_id])).rows[0]!.graph;
      const node = graph.nodes.find((candidate) => candidate.id===row.current_node_id)!; const c = node.config; let port = 'next';
      if (row.status!=='waiting') await this.events.publishDomain(client,row.workspace_id,'journey.node_entered',row.contact_id,row.id,{ nodeId: node.id });
      if (node.type==='end') return this.transition(client,row,'completed',node.id,'end',null);
      if (node.type==='wait' && row.status!=='waiting') { const wake = c.mode==='duration' ? new Date(this.now()+Number(c.amount)*({ minutes: 60000,hours: 3600000,days: 86400000 }[c.unit as 'minutes' | 'hours' | 'days'])) : new Date(String(c.untilAt)); return this.transition(client,row,'waiting',node.id,'wait_scheduled',wake); }
      if (node.type==='condition' || node.type==='branch') {
        const tags = (await client.query<{ tag: string }>('SELECT tag FROM contact_tags WHERE workspace_id=$1 AND contact_id=$2',[row.workspace_id,row.contact_id])).rows.map((value) => value.tag);
        const score = (await client.query<{ score: number }>('SELECT score FROM lead_scores WHERE workspace_id=$1 AND contact_id=$2',[row.workspace_id,row.contact_id])).rows[0]?.score ?? 0;
        const fields = (await client.query<{ fields: Record<string,unknown> }>('SELECT fields FROM contact_custom_fields WHERE workspace_id=$1 AND contact_id=$2',[row.workspace_id,row.contact_id])).rows[0]?.fields ?? {};
        const context = { contact: { name: contact.name,opted_out: false },tag: { tags },lead_score: { score,classification: scoreClassification(score) },custom_field: fields,journey_context: row.context,message_event: row.context.messageEvents ?? {} };
        port = node.type==='condition' ? evaluateCondition(c,context) ? 'true' : 'false' : String((c.paths as { key: string; condition: Record<string,unknown> }[]).find((path) => evaluateCondition(path.condition,context))?.key ?? 'default');
        if(node.type==='branch'){
          const payload=(row.context.messageEvents as Record<string,unknown>|undefined)?.actionPayload;
          const prefix=`journey_branch:${row.journey_id}:${node.id}:`;
          if(typeof payload==='string' && payload.startsWith(prefix)){
            const selected=payload.slice(prefix.length);
            if((c.paths as {key:string}[]).some(path=>path.key===selected))port=selected;
          }
        }
        if (node.type==='condition' && c.waitForEvent===true && port==='false' && row.status!=='waiting') return this.transition(client,row,'waiting',node.id,'event_wait_scheduled',new Date(this.now()+Number(c.timeoutMinutes)*60000));
      }
      if (node.type==='tag') { const changed = c.action==='add' ? await client.query('INSERT INTO contact_tags(workspace_id,contact_id,tag) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING tag',[row.workspace_id,row.contact_id,c.tag]) : await client.query('DELETE FROM contact_tags WHERE workspace_id=$1 AND contact_id=$2 AND tag=$3 RETURNING tag',[row.workspace_id,row.contact_id,c.tag]); if (changed.rowCount) await this.events.publishDomain(client,row.workspace_id,c.action==='add' ? 'contact.tag_added' : 'contact.tag_removed',row.contact_id,row.id,{ tag: c.tag }); }
      if (node.type==='score') {
        await client.query('INSERT INTO lead_scores(workspace_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.workspace_id,row.contact_id]);
        const previous = (await client.query<{ score: number }>('SELECT score FROM lead_scores WHERE workspace_id=$1 AND contact_id=$2 FOR UPDATE',[row.workspace_id,row.contact_id])).rows[0]!.score;
        const score = Math.min(1000000,Math.max(0,c.action==='set' ? Number(c.value) : previous+(c.action==='increase' ? Number(c.value) : -Number(c.value))));
        await client.query('UPDATE lead_scores SET score=$3,updated_at=now() WHERE workspace_id=$1 AND contact_id=$2',[row.workspace_id,row.contact_id,score]);
        await client.query('INSERT INTO lead_score_history(workspace_id,contact_id,source,source_key,delta,previous_score,new_score) VALUES($1,$2,\'journey_node\',$3,$4,$5,$6)',[row.workspace_id,row.contact_id,`${row.id}:${row.revision}`,score-previous,previous,score]);
        await this.events.publishDomain(client,row.workspace_id,'lead.score_changed',row.contact_id,row.id,{ previousScore: previous,score,delta: score-previous }); if (previous<50 && score>=50) await this.events.publishDomain(client,row.workspace_id,'lead.qualified',row.contact_id,row.id,{ score });
      }
      if (node.type==='goal') { await client.query('INSERT INTO journey_goals(workspace_id,enrollment_id,node_id,goal) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[row.workspace_id,row.id,node.id,c.goal]); await this.events.publishDomain(client,row.workspace_id,'journey.goal_reached',row.contact_id,row.id,{ nodeId: node.id,goal: c.goal }); if (c.stop) return this.transition(client,row,'converted',node.id,'goal',null); }
      if (node.type==='message') {
        const action = (await client.query<{ campaign_id: string }>('SELECT campaign_id FROM journey_message_actions WHERE workspace_id=$1 AND enrollment_id=$2 AND node_id=$3',[row.workspace_id,row.id,node.id])).rows[0];
        if (!action) return this.queueMessage(client,row,node.id,c);
        const attempt = (await client.query<{ id: string; status: string; provider_message_id: string | null; connection_id: string; created_at: Date }>('SELECT id,status,provider_message_id,connection_id,created_at FROM campaign_dispatch_attempts WHERE workspace_id=$1 AND campaign_id=$2 AND contact_id=$3',[row.workspace_id,action.campaign_id,row.contact_id])).rows[0];
        const outbox = (await client.query<{ status: string }>('SELECT status FROM campaign_dispatch_outbox WHERE workspace_id=$1 AND campaign_id=$2',[row.workspace_id,action.campaign_id])).rows[0];
        if (attempt?.status==='accepted') {
          const messageEvents=await this.events.messageSnapshot(client,row.workspace_id,attempt.connection_id,row.phone_normalized,attempt.id,attempt.provider_message_id,attempt.created_at);
          row.context = { ...row.context,lastMessageId: attempt.provider_message_id,lastMessageConnectionId: attempt.connection_id,lastMessageCampaignId: action.campaign_id,messageEvents };
        }
        else if (attempt?.status==='rejected' || attempt?.status==='unknown' || ['dead','discarded','unresolved'].includes(outbox?.status ?? '') || (attempt?.status==='sending' && new Date(attempt.created_at).getTime()+30000<=this.now())) return this.transition(client,row,'failed',node.id,'message_not_accepted',null);
        else { await client.query('UPDATE journey_enrollments SET wake_at=$3 WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.id,new Date(this.now()+5000)]); return 'waiting'; }
      }
      if (node.type==='webhook') {
        const action = (await client.query<{ status: string }>('SELECT status FROM journey_webhook_actions WHERE workspace_id=$1 AND enrollment_id=$2 AND node_id=$3',[row.workspace_id,row.id,node.id])).rows[0];
        if (!action) {
          if (!this.webhooks) return this.transition(client,row,'failed',node.id,'webhook_runtime_unavailable',null);
          try { await this.webhooks.queue(client,row,node.id,c); } catch (error) { if (!(error instanceof JourneyInputError)) throw error; return this.transition(client,row,'failed',node.id,'webhook_endpoint_unavailable',null); }
          return this.transition(client,row,'waiting',node.id,'webhook_queued',new Date(this.now()+2000));
        }
        if (['rejected','unknown','cancelled'].includes(action.status)) return this.transition(client,row,'failed',node.id,'webhook_not_accepted',null);
        if (action.status!=='accepted') { await client.query('UPDATE journey_enrollments SET wake_at=$3 WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.id,new Date(this.now()+5000)]); return 'waiting'; }
      }
      const next = graph.edges.find((edge) => edge.source===node.id && edge.port===port)?.target;
      if (!next) return this.transition(client,row,'failed',node.id,'missing_path',null);
      return this.transition(client,row,'active',next,port,new Date(this.now()));
    });
  }
  consumeEvent(job: EventJob) {
    return this.events.consume(job.workspace_id,job.id,'journeys',async (client,event) => {
      if (!('recipient' in event)) { await new JourneyEntries(this.pool,this.events,this.now).handleTag(client,event); return; }
      if (event.type==='contact.unsubscribe') { await client.query("UPDATE journey_enrollments SET status='opted_out',revision=revision+1,wake_at=NULL,completed_at=now(),last_activity_at=now() WHERE workspace_id=$1 AND phone_normalized=$2 AND status IN ('active','waiting')",[job.workspace_id,event.recipient]); return; }
      let messageId=event.providerMessageId;
      if(event.dispatchKey && /^dispatch-[a-f0-9-]{36}$/.test(event.dispatchKey) && ['action.selected','link.clicked'].includes(event.type)){
        messageId=(await client.query<{provider_message_id:string}>("SELECT provider_message_id FROM campaign_dispatch_attempts WHERE workspace_id=$1 AND connection_id=$2 AND phone_normalized=$3 AND id=$4 AND status='accepted'",[job.workspace_id,event.connectionId,event.recipient,event.dispatchKey.slice(9)])).rows[0]?.provider_message_id;
        if(!messageId)return;
      }
      if (!messageId) return;
      // Only events bound to the latest outgoing message affect this enrollment.
      const rows = (await client.query<Enrollment>(`SELECT e.* FROM journey_enrollments e WHERE e.workspace_id=$1 AND e.phone_normalized=$2 AND e.status IN ('active','waiting') AND e.context->>'lastMessageId'=$3 AND e.context->>'lastMessageConnectionId'=$4 FOR UPDATE`,[job.workspace_id,event.recipient,messageId,event.connectionId])).rows;
      for (const row of rows) {
        const messageEvents = { ...(row.context.messageEvents as Record<string,unknown> ?? {}),[event.type]: true,...(event.actionPayload?{actionPayload:event.actionPayload}:{}) };
        const node = (await client.query<{ node_type: string; config: Record<string,unknown> }>('SELECT node_type,config FROM journey_nodes WHERE workspace_id=$1 AND version_id=$2 AND node_id=$3',[row.workspace_id,row.version_id,row.current_node_id])).rows[0]!;
        const resume = row.status==='waiting' && node.node_type==='condition' && node.config.waitForEvent===true && evaluateCondition(node.config,{ message_event: messageEvents });
        await client.query('UPDATE journey_enrollments SET context=$3,last_activity_at=now(),wake_at=CASE WHEN $4 THEN $5 ELSE wake_at END,revision=revision+CASE WHEN $4 THEN 1 ELSE 0 END WHERE workspace_id=$1 AND id=$2',[job.workspace_id,row.id,JSON.stringify({ ...row.context,messageEvents }),resume,new Date(this.now())]);
        await this.audit(client,row,'journey.event_correlated',{ eventId: job.id,type: event.type });
      }
    });
  }
  private async queueMessage(client: PoolClient,row: Enrollment,nodeId: string,config: Record<string,unknown>) {
    const connection = (await client.query<{ provider_id: string; external_agent_id: string | null; status: string; ciphertext: string; revision: string }>(`SELECT p.provider_id,p.external_agent_id,p.status,k.ciphertext,EXTRACT(EPOCH FROM p.updated_at)::text AS revision FROM provider_connections p JOIN provider_credentials k ON k.workspace_id=p.workspace_id AND k.connection_id=p.id WHERE p.workspace_id=$1 AND p.id=$2 FOR SHARE OF p,k`,[row.workspace_id,config.connectionId])).rows[0];
    const message = (await client.query<{ content: CanonicalMessage; purpose: string }>(`SELECT v.content,v.purpose FROM message_versions v JOIN messages m ON m.workspace_id=v.workspace_id AND m.id=v.message_id WHERE v.workspace_id=$1 AND v.id=$2 AND m.status='active' AND m.active_version=v.version FOR SHARE OF v,m`,[row.workspace_id,config.messageVersionId])).rows[0];
    const descriptor = connection && this.registry.describe(connection.provider_id);
    if (!connection || connection.status!=='connected' || connection.external_agent_id!==config.agentId || !message || !descriptor?.active || descriptor.capabilities.text!=='supported' || descriptor.capabilities.eligibility!=='supported' || validateMessage(message.content,descriptor.capabilities,descriptor.limits).length) return this.transition(client,row,'failed',nodeId,'message_configuration_unavailable',null);
    const fingerprint = credentialVersion(connection.ciphertext,connection.revision);
    const eligible = await client.query(`SELECT contact_id FROM eligibility_checks WHERE workspace_id=$1 AND contact_id=$2 AND connection_id=$3 AND credential_version=$4 AND phone_normalized=$5 AND status='eligible' AND reason='provider_checked' AND expires_at>$6 FOR SHARE`,[row.workspace_id,row.contact_id,config.connectionId,fingerprint,row.phone_normalized,new Date(this.now())]);
    const consent = (await client.query<{ state: string }>('SELECT state FROM contact_rcs_consents WHERE workspace_id=$1 AND phone_normalized=$2 AND purpose=$3 ORDER BY revision DESC LIMIT 1',[row.workspace_id,row.phone_normalized,message.purpose])).rows[0];
    if (!eligible.rowCount || consent?.state!=='granted') return this.transition(client,row,'failed',nodeId,'message_recipient_unavailable',null);
    const list = (await client.query<{ id: string }>('INSERT INTO contact_lists(workspace_id,name) VALUES($1,$2) RETURNING id',[row.workspace_id,`Jornada ${row.id.slice(0,8)} / ${nodeId}`])).rows[0]!;
    await client.query('INSERT INTO contact_list_members(workspace_id,list_id,contact_id) VALUES($1,$2,$3)',[row.workspace_id,list.id,row.contact_id]);
    const campaign = (await client.query<{ id: string }>(`INSERT INTO campaigns(workspace_id,name,objective,provider_connection_id,agent_id,audience_list_id,message_version_id,created_by_user_id,updated_by_user_id,journey_enrollment_id) VALUES($1,$2,'Mensagem automática de jornada',$3,$4,$5,$6,$7,$7,$8) RETURNING id`,[row.workspace_id,`Jornada ${row.id.slice(0,8)} / ${nodeId}`,config.connectionId,config.agentId,list.id,config.messageVersionId,row.actor_user_id,row.id])).rows[0]!;
    const run = (await client.query<{ id: string }>(`INSERT INTO campaign_dispatch_runs(workspace_id,campaign_id,connection_id,message_version_id,audience_list_id,agent_id,credential_version,prepared_by_user_id,prepared_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,2) RETURNING id`,[row.workspace_id,campaign.id,config.connectionId,config.messageVersionId,list.id,config.agentId,fingerprint,row.actor_user_id])).rows[0]!;
    await client.query("INSERT INTO campaign_dispatch_recipients(workspace_id,run_id,campaign_id,contact_id,phone_normalized,disposition) VALUES($1,$2,$3,$4,$5,'eligible')",[row.workspace_id,run.id,campaign.id,row.contact_id,row.phone_normalized]);
    await client.query("UPDATE campaigns SET status='ready',execution_mode='dispatch',revision=4 WHERE workspace_id=$1 AND id=$2",[row.workspace_id,campaign.id]);
    await client.query('INSERT INTO campaign_dispatch_confirmations(workspace_id,run_id,campaign_id,actor_user_id,campaign_revision) VALUES($1,$2,$3,$4,3)',[row.workspace_id,run.id,campaign.id,row.actor_user_id]);
    await client.query('INSERT INTO campaign_dispatch_outbox(workspace_id,run_id,campaign_id,contact_id,actor_user_id,expected_revision,available_at) VALUES($1,$2,$3,$4,$5,4,$6)',[row.workspace_id,run.id,campaign.id,row.contact_id,row.actor_user_id,new Date(this.now())]);
    await client.query('INSERT INTO journey_message_actions(workspace_id,enrollment_id,node_id,campaign_id) VALUES($1,$2,$3,$4)',[row.workspace_id,row.id,nodeId,campaign.id]);
    await this.audit(client,row,'journey.message_queued',{ nodeId,campaignId: campaign.id,runId: run.id,authorization: 'published_journey_enrollment' });
    return this.transition(client,row,'waiting',nodeId,'message_queued',new Date(this.now()+2000));
  }
}
