import {retryDelay} from '@rcs/database';
import { createHash,randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { eventTypes,type CanonicalEvent,type ProviderRegistry,type WebhookRequest } from '@rcs/providers';
import type { CredentialCipher } from '@rcs/security';
import { credentialContext,credentialVersion } from './credentials.js';
import { transaction } from './transaction.js';
export class EventIngressError extends Error { constructor(readonly reason: 'invalid' | 'unavailable') { super('Webhook unavailable'); } }
export type EventJob = { id: string; workspace_id: string; attempts: number };
export const domainEventTypes = ['contact.tag_added','contact.tag_removed','campaign.started','campaign.completed','journey.entered','journey.node_entered','journey.node_completed','journey.goal_reached','journey.completed','lead.score_changed','lead.qualified'] as const;
export type DomainEvent = { id: string; workspaceId: string; type: typeof domainEventTypes[number]; contactId: string | null; occurredAt: string; correlationId: string; metadata: Record<string,unknown> };
export type BusEvent = CanonicalEvent | DomainEvent;
type Connection = { id: string; workspace_id: string; provider_id: string; environment: string; status: string; external_agent_id: string | null; ciphertext: string; revision: string };
type Receipt = EventJob & { connection_id: string; provider_id: string; credential_version: string; ciphertext: string; status: string; available_at: Date };
const bodyLimit = 65536;
function receiptContext(row: { id: string; workspace_id: string; connection_id: string; provider_id: string }) { return JSON.stringify(['webhook-receipt-v1',row.workspace_id,row.connection_id,row.provider_id,row.id]); }
function eventContext(workspaceId: string,id: string) { return JSON.stringify(['canonical-event-v1',workspaceId,id]); }
export function eventRecipientKey(workspaceId: string,connectionId: string,recipient: string) { return createHash('sha256').update(JSON.stringify([workspaceId,connectionId,recipient])).digest('hex'); }
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(controller.signal),new Promise<never>((_,reject) => { timer = setTimeout(() => { controller.abort(); reject(new EventIngressError('unavailable')); },10000); })]); }
  finally { clearTimeout(timer); controller.abort(); }
}
function validEvent(event: CanonicalEvent | null,connection: Connection): event is CanonicalEvent {
  return !!event && typeof event.id === 'string' && event.id.length>0 && event.id.length<=256 && eventTypes.includes(event.type)
    && event.workspaceId === connection.workspace_id && event.connectionId === connection.id && event.providerId === connection.provider_id
    && typeof event.recipient === 'string' && /^\+[1-9][0-9]{7,14}$/.test(event.recipient)
    && typeof event.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(event.occurredAt) && Number.isFinite(Date.parse(event.occurredAt))
    && (event.dispatchKey===undefined || /^dispatch-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(event.dispatchKey))
    && Buffer.byteLength(JSON.stringify(event))<=bodyLimit;
}
/** Signed ingress + durable encrypted receipt. Parser execution is deferred to worker. */
export class EventBus {
  constructor(private readonly pool: Pool,private readonly registry: ProviderRegistry,private readonly cipher?: CredentialCipher,private readonly now: () => number = Date.now) {}
  readyForDomainEvents() { return !!this.cipher; }
  /** Recover callbacks committed before the enrollment recorded its outgoing message. */
  async messageSnapshot(client: PoolClient,workspaceId: string,connectionId: string,recipient: string,attemptId: string,providerMessageId: string | null,since: Date) {
    if(!this.cipher) throw new EventIngressError('unavailable');
    const rows=(await client.query<{id:string;payload_ciphertext:string}>(`SELECT id,payload_ciphertext FROM canonical_events WHERE workspace_id=$1 AND connection_id=$2 AND recipient_hash=$3 AND created_at>=$4 AND ((provider_message_id=$5 AND (dispatch_key IS NULL OR dispatch_key=$6)) OR (dispatch_key=$6 AND event_type IN ('action.selected','link.clicked'))) ORDER BY occurred_at,created_at,id`,[workspaceId,connectionId,eventRecipientKey(workspaceId,connectionId,recipient),since,providerMessageId,`dispatch-${attemptId}`])).rows;
    const snapshot:Record<string,unknown>={};
    for(const row of rows){const event=JSON.parse(this.cipher.decrypt(row.payload_ciphertext,eventContext(workspaceId,row.id))) as CanonicalEvent;snapshot[event.type]=true;if(event.actionPayload)snapshot.actionPayload=event.actionPayload;}
    return snapshot;
  }
  private async connection(id: string) {
    return (await this.pool.query<Connection>(`SELECT p.id,p.workspace_id,p.provider_id,p.environment,p.status,p.external_agent_id,k.ciphertext,EXTRACT(EPOCH FROM p.updated_at)::text AS revision FROM provider_connections p JOIN provider_credentials k ON k.workspace_id=p.workspace_id AND k.connection_id=p.id JOIN workspaces w ON w.id=p.workspace_id AND w.status='active' WHERE p.id=$1`,[id])).rows[0];
  }
  private context(connection: Connection,signal: AbortSignal,challenge = false) {
    if (!this.cipher || !this.registry.describe(connection.provider_id) || (!challenge && (!this.registry.describe(connection.provider_id)?.active || connection.status !== 'connected')) || !connection.external_agent_id) throw new EventIngressError('unavailable');
    try {
      const credentials = JSON.parse(this.cipher.decrypt(connection.ciphertext,credentialContext(connection)));
      if (!challenge) {
        const adapter = this.registry.resolve(connection.provider_id);
        if (!adapter.validateCredentials(credentials,connection.environment) || (adapter.getExternalAgentId && adapter.getExternalAgentId(credentials,connection.environment) !== connection.external_agent_id)) throw new Error();
      }
      return { workspaceId: connection.workspace_id,connectionId: connection.id,environment: connection.environment,credentials,signal };
    } catch { throw new EventIngressError('unavailable'); }
  }
  async challenge(providerId: string,connectionId: string,request: WebhookRequest) {
    const connection = await this.connection(connectionId);
    if (!connection || connection.provider_id !== providerId) throw new EventIngressError('invalid');
    const verify = this.registry.webhookChallenge(providerId);
    if (!verify) throw new EventIngressError('invalid');
    const secret = await bounded((signal) => verify(this.context(connection,signal,true),request));
    if (secret === null) throw new EventIngressError('invalid');
    // No challenge payload or token is persisted, logged or normalized as a lead event.
    return secret;
  }
  async ingest(providerId: string,connectionId: string,request: WebhookRequest) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(providerId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(connectionId) || !request.rawBody.length || request.rawBody.length>bodyLimit) throw new EventIngressError('invalid');
    const headers = Object.fromEntries(Object.entries(request.headers).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
    if (Object.keys(headers).length>64 || Object.entries(headers).some(([key,value]) => key.length>128 || value.length>4096) || Buffer.byteLength(JSON.stringify(headers))>16384) throw new EventIngressError('invalid');
    const connection = await this.connection(connectionId);
    if (!connection || connection.provider_id !== providerId) throw new EventIngressError('invalid');
    let verified: boolean;
    try { verified = await bounded((signal) => this.registry.resolve(providerId).verifyWebhook(this.context(connection,signal),request)); }
    catch { throw new EventIngressError('unavailable'); }
    if (!verified) throw new EventIngressError('invalid');
    const version = credentialVersion(connection.ciphertext,connection.revision);
    const id = randomUUID(); const hash = createHash('sha256').update(request.rawBody).digest('hex');
    const ciphertext = this.cipher!.encrypt(JSON.stringify({ body: Buffer.from(request.rawBody).toString('base64'),headers }),receiptContext({ id,workspace_id: connection.workspace_id,connection_id: connection.id,provider_id: providerId }));
    return transaction(this.pool,async (client) => {
      await this.current(client,connection,version);
      const inserted = await client.query<{ id: string }>(`INSERT INTO webhook_receipts(id,workspace_id,connection_id,provider_id,credential_version,body_hash,ciphertext,available_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,connection_id,body_hash) DO NOTHING RETURNING id`,[id,connection.workspace_id,connection.id,providerId,version,hash,ciphertext,new Date(this.now())]);
      const receiptId = inserted.rows[0]?.id ?? (await client.query<{ id: string }>('SELECT id FROM webhook_receipts WHERE workspace_id=$1 AND connection_id=$2 AND body_hash=$3',[connection.workspace_id,connection.id,hash])).rows[0]!.id;
      if (inserted.rowCount) await this.audit(client,connection.workspace_id,receiptId,'webhook.received',{});
      return { receiptId,duplicate: !inserted.rowCount };
    });
  }
  private async current(client: PoolClient,connection: Connection,version: string) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[connection.workspace_id])).rowCount) throw new EventIngressError('unavailable');
    const row = (await client.query<{ ciphertext: string; revision: string; external_agent_id: string | null; status: string }>(`SELECT p.status,p.external_agent_id,k.ciphertext,EXTRACT(EPOCH FROM p.updated_at)::text AS revision FROM provider_connections p JOIN provider_credentials k ON k.workspace_id=p.workspace_id AND k.connection_id=p.id WHERE p.workspace_id=$1 AND p.id=$2 FOR SHARE OF p,k`,[connection.workspace_id,connection.id])).rows[0];
    if (!row || row.status !== 'connected' || row.external_agent_id !== connection.external_agent_id || credentialVersion(row.ciphertext,row.revision)!==version || !this.registry.describe(connection.provider_id)?.active) throw new EventIngressError('unavailable');
  }
  private audit(client: PoolClient,workspaceId: string,id: string,event: string,metadata: object) { return client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,NULL,$2,'webhook',$3,$4)",[workspaceId,event,id,JSON.stringify(metadata)]); }
  async due(): Promise<EventJob[]> {
    if (!this.cipher || !this.registry.list().some((entry) => entry.active)) return [];
    return (await this.pool.query<EventJob>("SELECT id,workspace_id,attempts FROM webhook_receipts WHERE status='pending' AND available_at<=$1 ORDER BY available_at,id LIMIT 20",[new Date(this.now())])).rows;
  }
  async execute(job: EventJob): Promise<string> {
    if (!this.cipher) throw new EventIngressError('unavailable');
    const receipt = (await this.pool.query<Receipt>('SELECT * FROM webhook_receipts WHERE workspace_id=$1 AND id=$2',[job.workspace_id,job.id])).rows[0];
    if (!receipt || receipt.status !== 'pending' || receipt.attempts !== job.attempts || new Date(receipt.available_at).getTime()>this.now()) return 'ignored';
    const connection = await this.connection(receipt.connection_id); let events: CanonicalEvent[] = []; const eligibility: {requestId:string;recipient:string;eligible:boolean|null}[]=[]; let invalid = false; let unavailable = false;
    try {
      if (!connection || connection.workspace_id !== receipt.workspace_id || connection.provider_id !== receipt.provider_id || credentialVersion(connection.ciphertext,connection.revision)!==receipt.credential_version) throw new EventIngressError('invalid');
      const raw = JSON.parse(this.cipher.decrypt(receipt.ciphertext,receiptContext(receipt))) as { body: string; headers: Record<string,string> };
      events = await bounded(async (signal) => {
        const context = this.context(connection,signal); const adapter = this.registry.resolve(receipt.provider_id);
        const parsed = await adapter.parseWebhook(context,{ rawBody: Buffer.from(raw.body,'base64'),headers: raw.headers });
        if (!Array.isArray(parsed) || !parsed.length || parsed.length>100) throw new EventIngressError('invalid');
        const result:CanonicalEvent[]=[];
        for(const value of parsed){
          const checked=adapter.normalizeEligibility?.(context,value);
          if(checked){if(!/^[a-f0-9-]{36}$/i.test(checked.requestId) || !/^\+[1-9][0-9]{7,14}$/.test(checked.recipient) || ![true,false,null].includes(checked.eligible))throw new EventIngressError('invalid');eligibility.push(checked);continue;}
          const event=adapter.normalizeEvent(context,value);if(!validEvent(event,connection))throw new EventIngressError('invalid');result.push(event);
        }
        return result;
      });
    } catch (error) { invalid = error instanceof EventIngressError && error.reason === 'invalid'; unavailable = !invalid; }
    return transaction(this.pool,async (client) => {
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[receipt.workspace_id]);
      const current = (await client.query<Receipt>('SELECT * FROM webhook_receipts WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[receipt.workspace_id,receipt.id])).rows[0]!;
      if (current.status !== 'pending' || current.attempts !== job.attempts || new Date(current.available_at).getTime()>this.now()) return 'ignored';
      if (!invalid && !unavailable) { try { await this.current(client,connection!,receipt.credential_version); } catch { invalid = true; } }
      const attempts = current.attempts+1; const status = invalid ? 'discarded' : unavailable ? attempts>=5 ? 'dead' : 'pending' : 'completed';
      if(status==='completed')for(const checked of eligibility){
        const result=await client.query<{contact_id:string;status:string}>(`UPDATE eligibility_checks e SET
          status=CASE WHEN EXISTS(SELECT 1 FROM opt_outs o WHERE o.workspace_id=e.workspace_id AND o.phone_normalized=e.phone_normalized) THEN 'blocked' WHEN $5::boolean IS TRUE THEN 'eligible' WHEN $5::boolean IS FALSE THEN 'ineligible' ELSE 'unknown' END,
          reason=CASE WHEN EXISTS(SELECT 1 FROM opt_outs o WHERE o.workspace_id=e.workspace_id AND o.phone_normalized=e.phone_normalized) THEN 'opted_out' ELSE 'provider_checked' END,checked_at=now(),expires_at=now()+interval '5 minutes'
          FROM contacts c,workspace_members m,users u WHERE e.workspace_id=$1 AND e.connection_id=$2 AND e.attempt_id=$3 AND e.phone_normalized=$4 AND e.reason='checking' AND e.expires_at>now() AND e.credential_version=$6
          AND c.workspace_id=e.workspace_id AND c.id=e.contact_id AND c.phone_normalized=e.phone_normalized
          AND m.workspace_id=e.workspace_id AND m.user_id=e.requested_by_user_id AND m.status='active' AND m.role IN ('owner','admin') AND u.id=m.user_id AND u.status='active' AND u.disabled_at IS NULL RETURNING e.contact_id,e.status`,[receipt.workspace_id,receipt.connection_id,checked.requestId,checked.recipient,checked.eligible,receipt.credential_version]);
        for(const row of result.rows)await this.audit(client,receipt.workspace_id,row.contact_id,'eligibility.checked',{connectionId:receipt.connection_id,status:row.status,receiptId:receipt.id});
      }
      if (status === 'completed') for (const event of events) {
        const id = randomUUID(); const result = await client.query(`INSERT INTO canonical_events(id,workspace_id,connection_id,receipt_id,provider_event_id,event_type,correlation_id,occurred_at,payload_ciphertext,provider_message_id,recipient_hash,dispatch_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(workspace_id,connection_id,provider_event_id) DO NOTHING RETURNING id`,[id,receipt.workspace_id,receipt.connection_id,receipt.id,event.id,event.type,receipt.id,new Date(event.occurredAt),this.cipher!.encrypt(JSON.stringify(event),eventContext(receipt.workspace_id,id)),event.providerMessageId ?? null,eventRecipientKey(receipt.workspace_id,receipt.connection_id,event.recipient),event.dispatchKey ?? null]);
        if (result.rowCount) await this.audit(client,receipt.workspace_id,id,'event.normalized',{ type: event.type,correlationId: receipt.id });
      }
      await client.query('UPDATE webhook_receipts SET status=$3,attempts=$4,available_at=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2',[receipt.workspace_id,receipt.id,status,attempts,new Date(this.now()+retryDelay(`${receipt.workspace_id}:${receipt.id}`,attempts))]);
      await this.audit(client,receipt.workspace_id,receipt.id,'webhook.processed',{ status,attempts }); return status;
    });
  }
  /** Effect and consumption marker must commit together; callback performs SQL only. */
  consume(workspaceId: string,eventId: string,consumer: 'campaigns' | 'journeys' | 'scoring' | 'analytics' | 'conversations' | 'audit',effect: (client: PoolClient,event: BusEvent) => Promise<void>) {
    return transaction(this.pool,async (client) => {
      if (!this.cipher || !(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[workspaceId])).rowCount) throw new EventIngressError('unavailable');
      const failure=(await client.query<{ attempts:number;available_at:Date }>('SELECT attempts,available_at FROM event_consumer_failures WHERE workspace_id=$1 AND event_id=$2 AND consumer=$3',[workspaceId,eventId,consumer])).rows[0];
      if (failure && (failure.attempts>=5 || new Date(failure.available_at).getTime()>this.now())) return false;
      const row = (await client.query<{ payload_ciphertext: string }>('SELECT payload_ciphertext FROM canonical_events WHERE workspace_id=$1 AND id=$2',[workspaceId,eventId])).rows[0];
      if (!row) throw new EventIngressError('invalid');
      const inserted = await client.query('INSERT INTO event_consumptions(workspace_id,event_id,consumer) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id',[workspaceId,eventId,consumer]);
      if (!inserted.rowCount) return false;
      const event = JSON.parse(this.cipher.decrypt(row.payload_ciphertext,eventContext(workspaceId,eventId))) as BusEvent;
      await effect(client,event); return true;
    }).catch(async (error:unknown) => {
      await this.pool.query(`INSERT INTO event_consumer_failures(workspace_id,event_id,consumer,attempts,available_at) SELECT $1,$2,$3,1,$4 FROM canonical_events WHERE workspace_id=$1 AND id=$2 ON CONFLICT(workspace_id,event_id,consumer) DO UPDATE SET attempts=LEAST(5,event_consumer_failures.attempts+1),available_at=$4,updated_at=now()`,[workspaceId,eventId,consumer,new Date(this.now()+30000)]);
      throw error;
    });
  }
  async pendingCampaignEvents(): Promise<EventJob[]> {
    if (!this.cipher) return [];
    return (await this.pool.query<EventJob>("SELECT e.id,e.workspace_id,COALESCE(f.generation*6+f.attempts,0) AS attempts FROM canonical_events e JOIN workspaces w ON w.id=e.workspace_id AND w.status='active' LEFT JOIN event_consumer_failures f ON f.workspace_id=e.workspace_id AND f.event_id=e.id AND f.consumer='campaigns' WHERE (f.event_id IS NULL OR (f.attempts<5 AND f.available_at<=$1)) AND NOT EXISTS(SELECT 1 FROM event_consumptions c WHERE c.workspace_id=e.workspace_id AND c.event_id=e.id AND c.consumer='campaigns') ORDER BY e.created_at,e.id LIMIT 20",[new Date(this.now())])).rows;
  }
  async pendingJourneyEvents(): Promise<EventJob[]> {
    if (!this.cipher) return [];
    return (await this.pool.query<EventJob>("SELECT e.id,e.workspace_id,COALESCE(f.generation*6+f.attempts,0) AS attempts FROM canonical_events e JOIN workspaces w ON w.id=e.workspace_id AND w.status='active' LEFT JOIN event_consumer_failures f ON f.workspace_id=e.workspace_id AND f.event_id=e.id AND f.consumer='journeys' WHERE (f.event_id IS NULL OR (f.attempts<5 AND f.available_at<=$1)) AND NOT EXISTS(SELECT 1 FROM event_consumptions c WHERE c.workspace_id=e.workspace_id AND c.event_id=e.id AND c.consumer='journeys') ORDER BY e.created_at,e.id LIMIT 20",[new Date(this.now())])).rows;
  }
  async pendingScoringEvents(): Promise<EventJob[]> {
    if (!this.cipher) return [];
    return (await this.pool.query<EventJob>("SELECT e.id,e.workspace_id,COALESCE(f.generation*6+f.attempts,0) AS attempts FROM canonical_events e JOIN workspaces w ON w.id=e.workspace_id AND w.status='active' LEFT JOIN event_consumer_failures f ON f.workspace_id=e.workspace_id AND f.event_id=e.id AND f.consumer='scoring' WHERE (f.event_id IS NULL OR (f.attempts<5 AND f.available_at<=$1)) AND NOT EXISTS(SELECT 1 FROM event_consumptions c WHERE c.workspace_id=e.workspace_id AND c.event_id=e.id AND c.consumer='scoring') ORDER BY e.created_at,e.id LIMIT 20",[new Date(this.now())])).rows;
  }
  async pendingConversationEvents(): Promise<EventJob[]> {
    if (!this.cipher) return [];
    return (await this.pool.query<EventJob>("SELECT e.id,e.workspace_id,COALESCE(f.generation*6+f.attempts,0) AS attempts FROM canonical_events e JOIN workspaces w ON w.id=e.workspace_id AND w.status='active' LEFT JOIN event_consumer_failures f ON f.workspace_id=e.workspace_id AND f.event_id=e.id AND f.consumer='conversations' WHERE (f.event_id IS NULL OR (f.attempts<5 AND f.available_at<=$1)) AND NOT EXISTS(SELECT 1 FROM event_consumptions c WHERE c.workspace_id=e.workspace_id AND c.event_id=e.id AND c.consumer='conversations') ORDER BY e.created_at,e.id LIMIT 20",[new Date(this.now())])).rows;
  }
  consumeCampaignEvent(job: EventJob) {
    return this.consume(job.workspace_id,job.id,'campaigns',async (client,event) => {
      if (!('recipient' in event)) return;
      if (event.type === 'contact.unsubscribe') {
        await client.query('INSERT INTO opt_outs(workspace_id,phone_normalized) VALUES($1,$2) ON CONFLICT DO NOTHING',[job.workspace_id,event.recipient]);
        await client.query("UPDATE journey_enrollments SET status='opted_out',revision=revision+1,wake_at=NULL,completed_at=now(),last_activity_at=now() WHERE workspace_id=$1 AND phone_normalized=$2 AND status IN ('active','waiting')",[job.workspace_id,event.recipient]);
        await client.query(`UPDATE campaign_dispatch_outbox o SET status='discarded',lease_token=NULL,lease_until=NULL,updated_at=now() FROM campaign_dispatch_recipients r WHERE o.workspace_id=$1 AND r.workspace_id=o.workspace_id AND r.run_id=o.run_id AND r.contact_id=o.contact_id AND r.phone_normalized=$2 AND o.status IN ('pending','processing') AND NOT EXISTS(SELECT 1 FROM campaign_dispatch_attempts a WHERE a.workspace_id=o.workspace_id AND a.campaign_id=o.campaign_id AND a.contact_id=o.contact_id)`,[job.workspace_id,event.recipient]);
      }
      // A subscribe event never clears global opt-out or declares lead consent.
      if (event.providerMessageId && ['message.sent','message.delivered','message.read','message.failed'].includes(event.type)) {
        await client.query(`INSERT INTO campaign_message_events(workspace_id,attempt_id,event_id,event_type,occurred_at) SELECT a.workspace_id,a.id,$2,$3,$4 FROM campaign_dispatch_attempts a LEFT JOIN dispatch_correlations c ON c.workspace_id=a.workspace_id AND c.attempt_id=a.id AND c.connection_id=a.connection_id WHERE a.workspace_id=$1 AND a.connection_id=$5 AND (a.provider_message_id=$6 OR c.provider_message_id=$6) AND a.phone_normalized=$7 ON CONFLICT DO NOTHING`,[job.workspace_id,job.id,event.type,new Date(event.occurredAt),event.connectionId,event.providerMessageId,event.recipient]);
      }
      await this.audit(client,job.workspace_id,job.id,'event.campaigns_consumed',{ type: event.type });
    });
  }
  async publishDomain(client: PoolClient,workspaceId: string,type: DomainEvent['type'],contactId: string | null,correlationId: string,metadata: Record<string,unknown> = {}) {
    if (!this.cipher || !domainEventTypes.includes(type) || Buffer.byteLength(JSON.stringify(metadata))>8192) throw new EventIngressError('unavailable');
    const id = randomUUID(); const event: DomainEvent = { id,workspaceId,type,contactId,correlationId,occurredAt: new Date(this.now()).toISOString(),metadata };
    await client.query(`INSERT INTO canonical_events(id,workspace_id,connection_id,receipt_id,provider_event_id,event_type,correlation_id,occurred_at,payload_ciphertext) VALUES($1,$2,NULL,NULL,$7,$3,$4,$5,$6)`,[id,workspaceId,type,correlationId,new Date(this.now()),this.cipher.encrypt(JSON.stringify(event),eventContext(workspaceId,id)),id]); return id;
  }
}
