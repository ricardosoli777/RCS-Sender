import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { describe,expect,it,vi } from 'vitest';
import { parseDispatchJob,publishDispatchJobs } from './dispatch-relay.js';
describe('prepared dispatch relay',() => {
  const job = { id: randomUUID(),workspace_id: randomUUID(),attempts: 0 };
  it('accepts only opaque identity and generation payloads including final lease recovery',() => {
    expect(parseDispatchJob(job)).toEqual(job); expect(parseDispatchJob({ ...job,attempts: 5 }).attempts).toBe(5);
    for (const invalid of [null,[],{ ...job,phone: '+5511987654321' },{ ...job,attempts: 6 },{ ...job,id: 'invalid' }]) expect(() => parseDispatchJob(invalid)).toThrow();
  });
  it('publishes stable bounded jobs without BullMQ send retries and repairs SQL-pending transport outcomes',async () => {
    const add = vi.fn(); const retry = vi.fn(); const remove = vi.fn();
    const getJob = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ getState: async () => 'active' }).mockResolvedValueOnce({ getState: async () => 'failed',retry }).mockResolvedValueOnce({ getState: async () => 'completed',remove });
    const queue = { add,getJob } as unknown as Pick<Queue,'getJob' | 'add'>; const outbox = { due: async () => [job] };
    for (let index = 0; index<4; index++) await publishDispatchJobs(outbox,queue);
    expect(add).toHaveBeenCalledTimes(2); expect(add).toHaveBeenCalledWith('campaign.dispatch.recipient',job,expect.objectContaining({ jobId: `dispatch-${job.id}-0`,attempts: 1 })); expect(retry).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
  });
});
