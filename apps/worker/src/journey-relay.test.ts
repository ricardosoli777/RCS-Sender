import { describe,expect,it,vi } from 'vitest';
import type { Queue } from 'bullmq';
import { parseJourneyJob,publishJourneyJobs } from './journey-relay.js';
const job = { enrollment_id: 'a3a89226-3aef-4fc8-b5e6-12fae6ed1149',workspace_id: 'b3a89226-3aef-4fc8-b5e6-12fae6ed1149',revision: 1 };
describe('journey persistent scheduling',() => {
  it('accepts only bounded identity and generation fields',() => { expect(parseJourneyJob(job)).toEqual(job); for (const value of [null,{ ...job,revision: 0 },{ ...job,revision: Infinity },{ ...job,phone: 'private' },{ ...job,enrollment_id: 'invalid' }]) expect(() => parseJourneyJob(value)).toThrow('Invalid journey job'); });
  it('uses stable revision identities and recreates completed transport jobs when SQL still requires work',async () => { const remove = vi.fn(async () => undefined); const queue = { getJob: vi.fn(async () => ({ getState: async () => 'completed',remove })),add: vi.fn(async () => undefined) }; await publishJourneyJobs({ due: async () => [job] },queue as unknown as Pick<Queue,'getJob' | 'add'>); expect(remove).toHaveBeenCalledOnce(); expect(queue.add).toHaveBeenCalledWith('journey.step',job,expect.objectContaining({ jobId: `journey-${job.enrollment_id}-1`,attempts: 1 })); });
});
