import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Pool} from 'pg';
import type {ProviderContext} from '@rcs/providers';
/** Account-scoped conservative request budget, shared by API and all worker processes. */
export class ProviderRequests {
  constructor(private readonly pool:Pool){}
  context(providerId:string,context:ProviderContext):ProviderContext{
    const c=context.credentials;
    const identity=providerId==='google_rbm' ? c.clientEmail : providerId==='twilio' ? c.accountSid : providerId==='sinch' ? c.projectId : providerId==='infobip' ? c.apiKey : providerId==='zenvia' ? c.apiToken : context.connectionId;
    const scope=createHash('sha256').update(JSON.stringify(['provider-request-v1',providerId,context.environment,identity])).digest('hex');
    return {...context,beforeRequest:async()=>{
      context.signal.throwIfAborted();
      const row=(await this.pool.query<{wait_ms:number}>(`INSERT INTO provider_request_windows(scope_hash,next_at) VALUES($1,clock_timestamp()+interval '1 second')
        ON CONFLICT(scope_hash) DO UPDATE SET next_at=GREATEST(provider_request_windows.next_at,clock_timestamp())+interval '1 second',updated_at=clock_timestamp()
        WHERE provider_request_windows.next_at<=clock_timestamp()+interval '7 seconds'
        RETURNING GREATEST(0,ceil(EXTRACT(EPOCH FROM (next_at-interval '1 second'-clock_timestamp()))*1000))::int AS wait_ms`,[scope])).rows[0];
      if(!row)throw new Error('Provider request budget unavailable');
      if(row.wait_ms)await delay(row.wait_ms,undefined,{signal:context.signal});
      context.signal.throwIfAborted();
    },rateLimited:async(seconds)=>{
      const cooldown=Math.min(3600,Math.max(1,Math.ceil(Number.isFinite(seconds) ? seconds : 60)));
      await this.pool.query(`INSERT INTO provider_request_windows(scope_hash,next_at) VALUES($1,clock_timestamp()+$2*interval '1 second')
        ON CONFLICT(scope_hash) DO UPDATE SET next_at=GREATEST(provider_request_windows.next_at,EXCLUDED.next_at),updated_at=clock_timestamp()`,[scope,cooldown]);
    }};
  }
}
