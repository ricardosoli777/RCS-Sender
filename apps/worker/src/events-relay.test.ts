import type { Queue } from 'bullmq';
import { describe,expect,it,vi } from 'vitest';
import { publishEventJobs } from './events-relay.js';
import { createJobHandler } from './job-handler.js';
const job = { id: 'a3a89226-3aef-4fc8-b5e6-12fae6ed1149',workspace_id: 'b3a89226-3aef-4fc8-b5e6-12fae6ed1149',attempts: 0 };
describe('persistent event worker wiring',() => {
  it('publishes independent normalization and consumption identities without payloads',async () => {
    const queue = { getJob: vi.fn(async () => undefined),add: vi.fn(async () => undefined) };
    await publishEventJobs({ due: async () => [job],pendingCampaignEvents: async () => [job] },queue as unknown as Pick<Queue,'getJob' | 'add'>);
    expect(queue.add).toHaveBeenNthCalledWith(1,'webhook.normalize',job,expect.objectContaining({ jobId: `webhook-${job.id}-0`,attempts: 1 })); expect(queue.add).toHaveBeenNthCalledWith(2,'event.consume.campaigns',job,expect.objectContaining({ jobId: `event-campaigns-${job.id}-0` }));
  });
  it('routes verified receipt processing and consumer effects separately and rejects extra fields',async () => {
    const events = { execute: vi.fn(async () => 'completed'),consumeCampaignEvent: vi.fn(async () => true) }; const noop = { execute: vi.fn(async () => 'ignored') };
    const handler = createJobHandler(noop,noop,new AbortController().signal,events);
    expect(await handler({ name: 'webhook.normalize',data: job })).toEqual({ status: 'completed' }); expect(await handler({ name: 'event.consume.campaigns',data: job })).toEqual({ consumed: true });
    await expect(handler({ name: 'webhook.normalize',data: { ...job,rawBody: 'private' } })).rejects.toThrow('Invalid dispatch job'); expect(events.execute).toHaveBeenCalledOnce(); expect(noop.execute).not.toHaveBeenCalled();
  });
});
