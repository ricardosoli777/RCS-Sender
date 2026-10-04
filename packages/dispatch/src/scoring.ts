import type { Pool } from 'pg';
import { ProviderRegistry } from '@rcs/providers';
import { transaction } from './transaction.js';
import { EventBus,type EventJob } from './events.js';
import { JourneyService,JourneyInputError } from './journeys.js';
import type { WorkspaceContext } from './contracts.js';
import { scoreClassification } from './journey-conditions.js';
export type ScoreRule = { eventType: string; delta: number; enabled: boolean; goal?: string };
export const defaultScoreRules: readonly ScoreRule[] = [{ eventType: 'message.delivered',delta: 1,enabled: true },{ eventType: 'message.read',delta: 2,enabled: true },{ eventType: 'link.clicked',delta: 5,enabled: true },{ eventType: 'action.selected',delta: 5,enabled: true },{ eventType: 'message.received',delta: 15,enabled: true },{ eventType: 'journey.goal_reached',goal: 'appointment_requested',delta: 30,enabled: true }];
export function validScoreRules(rules: unknown): rules is ScoreRule[] {
  if (!Array.isArray(rules) || rules.length>20) return false; const unique = new Set<string>();
  return rules.every((rule) => { if (!rule || typeof rule!=='object' || Array.isArray(rule) || Object.keys(rule).some((key) => !['eventType','delta','enabled','goal'].includes(key)) || !['message.delivered','message.read','link.clicked','action.selected','message.received','journey.goal_reached'].includes(rule.eventType) || !Number.isInteger(rule.delta) || Math.abs(rule.delta)>1000000 || typeof rule.enabled!=='boolean' || (rule.eventType==='journey.goal_reached' ? typeof rule.goal!=='string' || !/^[a-z0-9_:-]{1,64}$/.test(rule.goal) : rule.goal!==undefined)) return false; const key = `${rule.eventType}:${rule.goal ?? ''}`; if (unique.has(key)) return false; unique.add(key); return true; });
}
export class ScoringService {
  private readonly auth: JourneyService;
  constructor(private readonly pool: Pool,private readonly events: EventBus) { this.auth = new JourneyService(pool,new ProviderRegistry()); }
  settings(context: WorkspaceContext) { return transaction(this.pool,async (client) => { await this.auth.authorize(client,context); const row = (await client.query<{ revision: number; rules: ScoreRule[] }>('SELECT revision,rules FROM score_settings WHERE workspace_id=$1',[context.workspace_id])).rows[0]; return row ?? { revision: 0,rules: defaultScoreRules }; }); }
  saveSettings(context: WorkspaceContext,revision: number,rules: unknown) {
    if (!Number.isInteger(revision) || revision<0 || !validScoreRules(rules)) return Promise.reject(new JourneyInputError('invalid'));
    return transaction(this.pool,async (client) => { await this.auth.authorize(client,context,true); const current = (await client.query<{ revision: number }>('SELECT revision FROM score_settings WHERE workspace_id=$1 FOR UPDATE',[context.workspace_id])).rows[0]?.revision ?? 0; if (current!==revision) throw new JourneyInputError('conflict'); await client.query('INSERT INTO score_settings(workspace_id,revision,rules,updated_by_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE SET revision=EXCLUDED.revision,rules=EXCLUDED.rules,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()',[context.workspace_id,revision+1,JSON.stringify(rules),context.user_id]); await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,$2,'scoring.rules_updated','workspace',$4,$3)",[context.workspace_id,context.user_id,JSON.stringify({ revision: revision+1,rules: rules.length }),context.workspace_id]); return { revision: revision+1,rules }; });
  }
  contact(context: WorkspaceContext,contactId: string,offset = 0) { return transaction(this.pool,async (client) => { await this.auth.authorize(client,context); if (!(await client.query('SELECT id FROM contacts WHERE workspace_id=$1 AND id=$2',[context.workspace_id,contactId])).rowCount) throw new JourneyInputError('not_found'); const score = (await client.query<{ score: number }>('SELECT score FROM lead_scores WHERE workspace_id=$1 AND contact_id=$2',[context.workspace_id,contactId])).rows[0]?.score ?? 0; const history = (await client.query('SELECT id,source,delta,previous_score,new_score,created_at FROM lead_score_history WHERE workspace_id=$1 AND contact_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET $3',[context.workspace_id,contactId,offset])).rows; return { contactId,score,classification: scoreClassification(score),history }; }); }
  consumeEvent(job: EventJob) {
    return this.events.consume(job.workspace_id,job.id,'scoring',async (client,event) => {
      const rules = (await client.query<{ rules: ScoreRule[] }>('SELECT rules FROM score_settings WHERE workspace_id=$1',[job.workspace_id])).rows[0]?.rules ?? defaultScoreRules;
      const rule = rules.find((rule) => rule.enabled && rule.eventType===event.type && (rule.eventType!=='journey.goal_reached' || 'metadata' in event && event.metadata.goal===rule.goal)); if (!rule) return;
      let contactId: string | null = null;
      if ('contactId' in event) contactId = event.contactId;
      else if (event.type==='message.received' || event.type==='action.selected' || event.type==='link.clicked') contactId = (await client.query<{ id: string }>('SELECT id FROM contacts WHERE workspace_id=$1 AND phone_normalized=$2 FOR SHARE',[job.workspace_id,event.recipient])).rows[0]?.id ?? null;
      else if (event.providerMessageId) contactId = (await client.query<{ contact_id: string }>(`SELECT a.contact_id FROM campaign_dispatch_attempts a JOIN contacts c ON c.workspace_id=a.workspace_id AND c.id=a.contact_id AND c.phone_normalized=a.phone_normalized WHERE a.workspace_id=$1 AND a.connection_id=$2 AND a.provider_message_id=$3 AND a.phone_normalized=$4 ORDER BY a.created_at DESC LIMIT 1`,[job.workspace_id,event.connectionId,event.providerMessageId,event.recipient])).rows[0]?.contact_id ?? null;
      if (!contactId || !(await client.query('SELECT id FROM contacts WHERE workspace_id=$1 AND id=$2',[job.workspace_id,contactId])).rowCount) return;
      await client.query('INSERT INTO lead_scores(workspace_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[job.workspace_id,contactId]); const previous = (await client.query<{ score: number }>('SELECT score FROM lead_scores WHERE workspace_id=$1 AND contact_id=$2 FOR UPDATE',[job.workspace_id,contactId])).rows[0]!.score; const score = Math.max(0,Math.min(1000000,previous+rule.delta));
      await client.query('INSERT INTO lead_score_history(workspace_id,contact_id,source,source_key,event_id,delta,previous_score,new_score) VALUES($1,$2,\'canonical_event\',$3,$4,$5,$6,$7)',[job.workspace_id,contactId,`event:${job.id}`,job.id,score-previous,previous,score]); await client.query('UPDATE lead_scores SET score=$3,updated_at=now() WHERE workspace_id=$1 AND contact_id=$2',[job.workspace_id,contactId,score]);
      await this.events.publishDomain(client,job.workspace_id,'lead.score_changed',contactId,job.id,{ previousScore: previous,score,delta: score-previous,sourceEventId: job.id }); if (previous<50 && score>=50) await this.events.publishDomain(client,job.workspace_id,'lead.qualified',contactId,job.id,{ score });
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,NULL,'lead.score_changed','contact',$2,$3)",[job.workspace_id,contactId,JSON.stringify({ eventId: job.id,previousScore: previous,score })]);
    });
  }
}
