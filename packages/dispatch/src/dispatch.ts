import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { CredentialCipher } from '@rcs/security';
import { correlateActions,validateMessage,type CanonicalMessage,type Credentials,type ErrorCode,type ProviderContext,type ProviderRegistry,type SendResult } from '@rcs/providers';
import type { WorkspaceContext } from './contracts.js';
import { WorkspaceAccessError } from './contracts.js';
import { transaction } from './transaction.js';
import { credentialContext } from './credentials.js';
import { credentialVersion } from './credentials.js';
import { CampaignInputError,type Campaign } from './contracts.js';
import { ProviderMediaAccess } from './provider-media.js';
import { ProviderRequests } from './provider-requests.js';

export type DispatchReceipt = { id: string; status: 'sending' | 'accepted' | 'rejected' | 'unknown'; providerMessageId: string | null; errorCode: ErrorCode | null };
const receiptColumns = 'id,status,provider_message_id AS "providerMessageId",error_code AS "errorCode"';
type Connection = { id: string; workspace_id: string; provider_id: string; environment: string; status: string; external_agent_id: string | null; revision: string; ciphertext: string };
type Reserved = { receipt: DispatchReceipt; context: ProviderContext; providerId: string; agentId: string; phone: string; message: CanonicalMessage; credentialVersion: string };

function bounded<T>(signal: AbortSignal,operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve,reject) => {
    const abort = () => reject(new Error('Dispatch interrupted'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort',abort,{ once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

/** Text-only dispatcher shared by worker and local contract tests. */
export class CampaignDispatch {
  constructor(private readonly pool: Pool,private readonly registry: ProviderRegistry,private readonly cipher: CredentialCipher,private readonly now: () => number = Date.now,private readonly mediaOrigin?: string) {}
  private async authorize(client: PoolClient,context: WorkspaceContext) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0];
    if (!member) throw new WorkspaceAccessError('not_found'); if (!['owner','admin','operator'].includes(member.role)) throw new WorkspaceAccessError('forbidden');
  }
  private reserve(context: WorkspaceContext,campaignId: string,contactId: string,expectedRevision: number,signal: AbortSignal): Promise<Reserved | DispatchReceipt> {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const campaign = (await client.query<Campaign>('SELECT * FROM campaigns WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,campaignId])).rows[0];
      if (!campaign) throw new CampaignInputError('not_found');
      // Retries can observe a persisted outcome even after campaign controls change.
      const existing = (await client.query<DispatchReceipt>(`SELECT ${receiptColumns} FROM campaign_dispatch_attempts WHERE workspace_id=$1 AND campaign_id=$2 AND contact_id=$3`,[context.workspace_id,campaignId,contactId])).rows[0];
      if (existing) return existing;
      if (signal.aborted || campaign.execution_mode !== 'dispatch' || !['ready','queued','running'].includes(campaign.status) || campaign.revision !== expectedRevision || (campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() > this.now())) throw new CampaignInputError('conflict');
      if (campaign.journey_enrollment_id && !(await client.query(`SELECT e.id FROM journey_enrollments e JOIN journeys j ON j.workspace_id=e.workspace_id AND j.id=e.journey_id AND j.status='active' JOIN journey_message_actions a ON a.workspace_id=e.workspace_id AND a.enrollment_id=e.id AND a.node_id=e.current_node_id AND a.campaign_id=$3 WHERE e.workspace_id=$1 AND e.id=$2 AND e.contact_id=$4 AND e.status='waiting' FOR SHARE OF e,j`,[context.workspace_id,campaign.journey_enrollment_id,campaignId,contactId])).rowCount) throw new CampaignInputError('conflict');
      const run = (await client.query<{ id: string; credential_version: string }>(`SELECT r.id,r.credential_version FROM campaign_dispatch_runs r JOIN campaign_dispatch_confirmations f ON f.workspace_id=r.workspace_id AND f.run_id=r.id WHERE r.workspace_id=$1 AND r.campaign_id=$2 AND r.connection_id=$3 AND r.message_version_id=$4 AND r.audience_list_id=$5 AND r.agent_id=$6 AND r.not_before IS NOT DISTINCT FROM $7::timestamptz`,[context.workspace_id,campaignId,campaign.provider_connection_id,campaign.message_version_id,campaign.audience_list_id,campaign.agent_id,campaign.scheduled_at])).rows[0];
      if (!run) throw new CampaignInputError('conflict');
      const connection = (await client.query<Connection>(`SELECT p.id,p.workspace_id,p.provider_id,p.environment,p.status,p.external_agent_id,EXTRACT(EPOCH FROM p.updated_at)::text AS revision,k.ciphertext FROM provider_connections p JOIN provider_credentials k ON k.workspace_id=p.workspace_id AND k.connection_id=p.id WHERE p.workspace_id=$1 AND p.id=$2 FOR SHARE OF p,k`,[context.workspace_id,campaign.provider_connection_id])).rows[0];
      if (!connection || connection.status !== 'connected' || !campaign.agent_id || connection.external_agent_id !== campaign.agent_id) throw new CampaignInputError('conflict');
      const descriptor = this.registry.describe(connection.provider_id);
      if (!descriptor?.active || descriptor.capabilities.text !== 'supported' || descriptor.capabilities.eligibility !== 'supported') throw new CampaignInputError('conflict');
      const version = credentialVersion(connection.ciphertext,connection.revision);
      if (version !== run.credential_version) throw new CampaignInputError('conflict');
      const recipient = (await client.query<{ phone: string }>(`SELECT r.phone_normalized AS phone FROM campaign_dispatch_recipients r JOIN contacts c ON c.workspace_id=r.workspace_id AND c.id=r.contact_id JOIN eligibility_checks e ON e.workspace_id=c.workspace_id AND e.contact_id=c.id AND e.connection_id=$4 WHERE r.workspace_id=$1 AND r.run_id=$2 AND c.id=$3 AND r.disposition='eligible' AND c.phone_normalized=r.phone_normalized AND e.status='eligible' AND e.reason='provider_checked' AND e.phone_normalized=r.phone_normalized AND e.credential_version=$5 AND e.expires_at>$6 AND NOT EXISTS (SELECT 1 FROM opt_outs o WHERE o.workspace_id=c.workspace_id AND o.phone_normalized=r.phone_normalized) FOR SHARE OF c,e`,[context.workspace_id,run.id,contactId,connection.id,version,new Date(this.now())])).rows[0];
      if (!recipient) throw new CampaignInputError('conflict');
      const message = (await client.query<{ content: CanonicalMessage }>(`SELECT v.content FROM message_versions v JOIN messages m ON m.workspace_id=v.workspace_id AND m.id=v.message_id WHERE v.workspace_id=$1 AND v.id=$2 AND m.status='active' AND m.active_version=v.version FOR SHARE OF v,m`,[context.workspace_id,campaign.message_version_id])).rows[0]?.content;
      if (!message || validateMessage(message,descriptor.capabilities,descriptor.limits).length) throw new CampaignInputError('conflict');
      const consent = (await client.query<{ state: string }>(`SELECT s.state FROM contact_rcs_consents s JOIN message_versions v ON v.workspace_id=s.workspace_id AND v.purpose=s.purpose WHERE s.workspace_id=$1 AND s.phone_normalized=$2 AND v.id=$3 ORDER BY s.revision DESC LIMIT 1`,[context.workspace_id,recipient.phone,campaign.message_version_id])).rows[0];
      if (consent?.state !== 'granted') throw new CampaignInputError('conflict');
      let credentials: Credentials;
      try { credentials = JSON.parse(this.cipher.decrypt(connection.ciphertext,credentialContext(connection))); }
      catch { throw new CampaignInputError('conflict'); }
      const adapter = this.registry.resolve(connection.provider_id);
      try {
        if (!adapter.validateCredentials(credentials,connection.environment) || (adapter.getExternalAgentId && adapter.getExternalAgentId(credentials,connection.environment) !== campaign.agent_id)) throw new Error();
      } catch { throw new CampaignInputError('conflict'); }
      const id = randomUUID();
      const receipt = (await client.query<DispatchReceipt>(`INSERT INTO campaign_dispatch_attempts (id,workspace_id,campaign_id,contact_id,connection_id,message_version_id,actor_user_id,campaign_revision,credential_version,phone_normalized,agent_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sending') RETURNING ${receiptColumns}`,[id,context.workspace_id,campaignId,contactId,connection.id,campaign.message_version_id,context.user_id,campaign.revision,version,recipient.phone,campaign.agent_id])).rows[0]!;
      const providerContext={workspaceId:context.workspace_id,connectionId:connection.id,environment:connection.environment,credentials,signal};
      const identity=adapter.getSendIdentity?.(providerContext,{agentId:campaign.agent_id,recipient:recipient.phone,idempotencyKey:`dispatch-${id}`,message});
      if(identity){if(!identity.trim() || identity.length>256)throw new CampaignInputError('conflict');await client.query('INSERT INTO dispatch_correlations(workspace_id,connection_id,attempt_id,provider_message_id) VALUES($1,$2,$3,$4)',[context.workspace_id,connection.id,id,identity]);}
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.dispatch_reserved','campaign',$3,$4)",[context.workspace_id,context.user_id,campaignId,JSON.stringify({ attemptId: id,revision: campaign.revision })]);
      return { receipt,providerId: connection.provider_id,agentId: campaign.agent_id,phone: recipient.phone,message,credentialVersion: version,context:providerContext };
    });
  }
  private beforeSend(context: WorkspaceContext,campaignId: string,contactId: string,expectedRevision: number,reserved: Reserved) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const valid = (await client.query<{ ciphertext: string; revision: string }>(`SELECT k.ciphertext,EXTRACT(EPOCH FROM p.updated_at)::text AS revision
        FROM campaigns a JOIN provider_connections p ON p.workspace_id=a.workspace_id AND p.id=a.provider_connection_id
        JOIN provider_credentials k ON k.workspace_id=p.workspace_id AND k.connection_id=p.id
        JOIN campaign_dispatch_runs r ON r.workspace_id=a.workspace_id AND r.campaign_id=a.id AND r.connection_id=p.id AND r.message_version_id=a.message_version_id AND r.audience_list_id=a.audience_list_id AND r.agent_id=a.agent_id AND r.not_before IS NOT DISTINCT FROM a.scheduled_at
        JOIN campaign_dispatch_confirmations f ON f.workspace_id=r.workspace_id AND f.run_id=r.id
        JOIN campaign_dispatch_recipients cr ON cr.workspace_id=r.workspace_id AND cr.run_id=r.id AND cr.contact_id=$3 AND cr.disposition='eligible' AND cr.phone_normalized=$8
        JOIN contacts c ON c.workspace_id=cr.workspace_id AND c.id=cr.contact_id
        JOIN eligibility_checks e ON e.workspace_id=c.workspace_id AND e.contact_id=c.id AND e.connection_id=p.id
        JOIN message_versions v ON v.workspace_id=a.workspace_id AND v.id=a.message_version_id
        JOIN messages m ON m.workspace_id=v.workspace_id AND m.id=v.message_id
        WHERE a.workspace_id=$1 AND a.id=$2 AND a.revision=$4 AND a.execution_mode='dispatch' AND a.status IN ('ready','queued','running')
          AND (a.scheduled_at IS NULL OR a.scheduled_at<=$5) AND p.status='connected' AND p.id=$6 AND p.external_agent_id=$7 AND a.agent_id=$7
          AND (a.journey_enrollment_id IS NULL OR EXISTS(SELECT 1 FROM journey_enrollments je JOIN journeys jj ON jj.workspace_id=je.workspace_id AND jj.id=je.journey_id AND jj.status='active' JOIN journey_message_actions ja ON ja.workspace_id=je.workspace_id AND ja.enrollment_id=je.id AND ja.node_id=je.current_node_id AND ja.campaign_id=a.id WHERE je.workspace_id=a.workspace_id AND je.id=a.journey_enrollment_id AND je.status='waiting'))
          AND c.phone_normalized=$8 AND r.credential_version=$9 AND e.phone_normalized=c.phone_normalized AND e.credential_version=$9 AND e.status='eligible' AND e.reason='provider_checked' AND e.expires_at>$5
          AND m.status='active' AND m.active_version=v.version
          AND (SELECT s.state FROM contact_rcs_consents s WHERE s.workspace_id=c.workspace_id AND s.phone_normalized=c.phone_normalized AND s.purpose=v.purpose ORDER BY s.revision DESC LIMIT 1)='granted'
          AND NOT EXISTS (SELECT 1 FROM opt_outs o WHERE o.workspace_id=c.workspace_id AND o.phone_normalized=c.phone_normalized)
        FOR SHARE OF a,p,k,c,e,m`,[context.workspace_id,campaignId,contactId,expectedRevision,new Date(this.now()),reserved.context.connectionId,reserved.agentId,reserved.phone,reserved.credentialVersion])).rows[0];
      const descriptor = this.registry.describe(reserved.providerId);
      return !!valid && credentialVersion(valid.ciphertext,valid.revision) === reserved.credentialVersion && !!descriptor?.active && descriptor.capabilities.text === 'supported' && descriptor.capabilities.eligibility === 'supported';
    });
  }
  async dispatch(context: WorkspaceContext,campaignId: string,contactId: string,expectedRevision: number,signal: AbortSignal): Promise<DispatchReceipt> {
    const reserved = await this.reserve(context,campaignId,contactId,expectedRevision,signal);
    if (!('receipt' in reserved)) return reserved;
    const adapter = this.registry.resolve(reserved.providerId);
    let status: DispatchReceipt['status'] = 'unknown'; let errorCode: ErrorCode | null = 'unknown'; let providerMessageId: string | null = null;
    const operationSignal = AbortSignal.any([signal,AbortSignal.timeout(10000)]);
    const providerContext: ProviderContext = new ProviderRequests(this.pool).context(reserved.providerId,{ ...reserved.context,signal: operationSignal,
      resolveMedia: (media) => new ProviderMediaAccess(this.pool,this.mediaOrigin).grant(context.workspace_id,reserved.context.connectionId,reserved.receipt.id,media) });
    try {
      const result = await bounded(operationSignal,async (): Promise<SendResult> => {
        const agent = await adapter.getAgent(providerContext,reserved.agentId);
        operationSignal.throwIfAborted();
        if (!agent || agent.id !== reserved.agentId || agent.status !== 'active') return { accepted: false,error: { code: 'rejected',message: 'Agent unavailable',retryable: false } };
        const caps = await adapter.getAgentCapabilities(providerContext,reserved.agentId);
        if (validateMessage(reserved.message,caps,adapter.getProviderLimits()).length) return { accepted: false,error: { code: 'unsupported_capability',message: 'Message unsupported',retryable: false } };
        if (adapter.getProviderCapabilities().recipient_capabilities === 'supported') {
          const recipientCaps = await adapter.getCapabilities!(providerContext,reserved.phone);
          if (validateMessage(reserved.message,recipientCaps,adapter.getProviderLimits()).length) return { accepted: false,error: { code: 'unsupported_capability',message: 'Recipient unsupported',retryable: false } };
        }
        if (!await this.beforeSend(context,campaignId,contactId,expectedRevision,reserved)) return { accepted: false,error: { code: 'rejected',message: 'Dispatch invalidated',retryable: false } };
        operationSignal.throwIfAborted();
        const key=`dispatch-${reserved.receipt.id}`;
        return adapter.send(providerContext,{ agentId: reserved.agentId,recipient: reserved.phone,message: correlateActions(reserved.message,key),idempotencyKey:key });
      });
      if (result.accepted && typeof result.providerMessageId === 'string' && /^[A-Za-z0-9._~-]{1,256}$/.test(result.providerMessageId)) { status = 'accepted'; errorCode = null; providerMessageId = result.providerMessageId; }
      else if (!result.accepted) {
        const codes: readonly ErrorCode[] = ['invalid_credentials','invalid_message','unsupported_capability','rate_limited','unavailable','rejected','unknown'];
        errorCode = codes.includes(result.error?.code) ? result.error.code : 'unknown';
        status = ['unavailable','unknown'].includes(errorCode) ? 'unknown' : 'rejected';
      }
    } catch { /* Transport exceptions/cancellation are ambiguous: never auto-resend. */ }
    // No role/state check here: persist the already-started operation even if its
    // initiating account or campaign was revoked while the provider was running.
    return transaction(this.pool,async (client) => {
      const updated = (await client.query<DispatchReceipt>(`UPDATE campaign_dispatch_attempts SET status=$3,provider_message_id=$4,error_code=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='sending' RETURNING ${receiptColumns}`,[context.workspace_id,reserved.receipt.id,status,providerMessageId,errorCode])).rows[0];
      if (!updated) throw new CampaignInputError('conflict');
      await client.query("INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.dispatch_result','campaign',$3,$4)",[context.workspace_id,context.user_id,campaignId,JSON.stringify({ attemptId: updated.id,status,errorCode })]); return updated;
    });
  }
}
