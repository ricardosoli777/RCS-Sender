import type { ProviderRegistry,ProviderContext } from '@rcs/providers';
import type { ProviderStore } from '../providers/domain/contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { EligibilityInputError, type EligibilityResult, type EligibilityStore } from './contracts.js';

function cancellable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Operation cancelled'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
export class EligibilityService {
  constructor(private readonly registry: ProviderRegistry, private readonly providers: ProviderStore, private readonly store: EligibilityStore,private readonly requestContext:(providerId:string,context:ProviderContext)=>ProviderContext=(_id,context)=>context) {}
  async check(context: WorkspaceContext, connectionId: string, contactId: string, signal: AbortSignal) {
    const contact = await this.store.contact(context, contactId);
    if (!contact) throw new EligibilityInputError('not_found');
    const loaded = await this.providers.loadForProvider(context, connectionId);
    if (!loaded) throw new EligibilityInputError('not_found');
    if (signal.aborted) throw new EligibilityInputError('stale');
    const attemptId = await this.store.begin(context, connectionId, contactId, loaded.credentialVersion, contact.phone);
    if (!attemptId) throw new EligibilityInputError('stale');
    let result: Pick<EligibilityResult, 'status' | 'reason'> = { status: 'unknown', reason: 'unsupported' };
    if (contact.optedOut) result = { status: 'blocked', reason: 'opted_out' };
    else if (loaded.connection.status !== 'connected') result = { status: 'unknown', reason: 'connection_unavailable' };
    else {
      const descriptor = this.registry.describe(loaded.connection.provider_id);
      if (!descriptor?.active) result = { status: 'unknown', reason: 'provider_unavailable' };
      else if (descriptor.capabilities.eligibility === 'supported') {
        try {
          const adapter = this.registry.resolve(loaded.connection.provider_id);
          if (!adapter.validateCredentials(loaded.credentials, loaded.connection.environment)
            || (adapter.getExternalAgentId && adapter.getExternalAgentId(loaded.credentials, loaded.connection.environment) !== loaded.connection.external_agent_id)) throw new Error('Invalid connection');
          const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
          const providerContext=this.requestContext(loaded.connection.provider_id,{workspaceId:context.workspace_id,connectionId,environment:loaded.connection.environment,credentials:loaded.credentials,signal:operationSignal});
          if(adapter.requestEligibility){
            const registered=await cancellable(operationSignal,()=>adapter.requestEligibility!(providerContext,contact.phone,attemptId));
            if(registered){signal.throwIfAborted();return {status:'unknown' as const,reason:'checking' as const,checkedAt:new Date(),expiresAt:new Date(Date.now()+300000)};}
            throw new Error('Eligibility unavailable');
          }
          const eligible = await cancellable(operationSignal, () => adapter.checkEligibility!(providerContext, contact.phone));
          result = eligible === true ? { status: 'eligible', reason: 'provider_checked' } : eligible === false
            ? { status: 'ineligible', reason: 'provider_checked' } : { status: 'unknown', reason: 'provider_unavailable' };
        } catch { result = { status: 'unknown', reason: 'provider_unavailable' }; }
      }
    }
    if (signal.aborted) throw new EligibilityInputError('stale');
    const saved = await this.store.save(context, connectionId, contactId, loaded.credentialVersion, attemptId, result);
    if (!saved) throw new EligibilityInputError('stale');
    return saved;
  }
}
