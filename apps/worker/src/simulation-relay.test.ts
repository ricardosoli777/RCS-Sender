import { describe,expect,it,vi } from 'vitest';
import type { Queue } from 'bullmq';
import { parseSimulationJob,publishSimulationJobs } from './simulation-relay.js';
const row = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',workspace_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',attempts: 0 };
describe('durable simulation relay',() => {
  it('publishes only identifiers with deterministic per-attempt IDs and bounded retention',async () => {
    const add = vi.fn(); const queue = { getJob: vi.fn(async () => undefined),add } as unknown as Queue;
    await publishSimulationJobs({ due: async () => [row,{ ...row,attempts: 1 }] },queue);
    expect(add.mock.calls[0]).toEqual(['campaign.simulation.batch',row,{ jobId: `simulation-${row.id}-0`,attempts: 3,backoff: { type: 'exponential',delay: 1000 },removeOnComplete: { count: 1000 },removeOnFail: { count: 1000 } }]); expect(add.mock.calls[1]![2].jobId).toBe(`simulation-${row.id}-1`);
  });
  it('retains SQL intent when Redis publication fails and retries the same identity',async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error('Redis down')).mockResolvedValueOnce({}); const due = vi.fn(async () => [row]); const queue = { getJob: vi.fn(async () => undefined),add } as unknown as Queue;
    await expect(publishSimulationJobs({ due },queue)).rejects.toThrow('Redis down'); await publishSimulationJobs({ due },queue);
    expect(add.mock.calls[0]![2].jobId).toBe(add.mock.calls[1]![2].jobId); expect(due).toHaveBeenCalledTimes(2);
  });
  it('skips live jobs and recovers failed or completed deliveries while SQL remains pending',async () => {
    for (const state of ['waiting','active','failed','completed']) {
      const retry = vi.fn(); const remove = vi.fn(); const add = vi.fn(); const queue = { getJob: vi.fn(async () => ({ getState: async () => state,retry,remove })),add } as unknown as Queue;
      await publishSimulationJobs({ due: async () => [row] },queue);
      expect(retry).toHaveBeenCalledTimes(state === 'failed' ? 1 : 0); expect(remove).toHaveBeenCalledTimes(state === 'completed' ? 1 : 0); expect(add).toHaveBeenCalledTimes(state === 'completed' ? 1 : 0);
    }
  });
  it('rejects malformed, cross-purpose and exhausted queue payloads without leaking their values',() => {
    expect(parseSimulationJob(row)).toEqual(row);
    for (const data of [null,[],{ ...row,id: 'private phone' },{ ...row,workspace_id: 'foreign' },{ ...row,attempts: 5 },{ ...row,attempts: -1 },{ ...row,attempts: 1.5 },{ ...row,mode: 'real' }]) expect(() => parseSimulationJob(data)).toThrow('Invalid simulation job');
  });
});
