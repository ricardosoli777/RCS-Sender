import type { Queue } from 'bullmq';
import { describe,it,expect,vi } from 'vitest';
import { publishEntryJobs } from './entry-relay.js';
import { publishWebhookJobs } from './webhook-relay.js';
import { parseEventJob } from './events-relay.js';
const row={id:'11111111-1111-4111-8111-111111111111',workspace_id:'22222222-2222-4222-8222-222222222222',attempts:0};
describe('entry and webhook recovery relays',()=>{
  for(const [name,publish] of [['entries',publishEntryJobs],['webhooks',publishWebhookJobs]] as const)it(`${name} reconstructs missing jobs and replaces completed jobs still due in SQL`,async()=>{
    const existing={getState:vi.fn(async()=> 'completed'),remove:vi.fn(async()=>{}),retry:vi.fn(async()=>{})};const queue={getJob:vi.fn(async()=>existing),add:vi.fn(async(...args:unknown[])=>{void args;})};await publish({due:async()=>[row]},queue as unknown as Pick<Queue,'getJob'|'add'>);expect(existing.remove).toHaveBeenCalledOnce();expect(queue.add).toHaveBeenCalledOnce();expect(queue.add.mock.calls[0]?.[1]).toEqual(row);
  });
  it('accepts a manual consumer recovery generation while blocking private payload fields',()=>{expect(parseEventJob({...row,attempts:6})).toEqual({...row,attempts:6});expect(()=>parseEventJob({...row,payload:'private'})).toThrow();expect(()=>parseEventJob({...row,attempts:-1})).toThrow();});
});
