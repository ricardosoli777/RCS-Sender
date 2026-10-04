import type { Queue } from 'bullmq';
export type DispatchJob = { id: string; workspace_id: string; attempts: number };
/** SQL remains authoritative; unavailable runtimes return no due jobs. */
export async function publishDispatchJobs(outbox: { due(): Promise<DispatchJob[]> },queue: Pick<Queue,'getJob' | 'add'>) {
  for (const row of await outbox.due()) {
    const jobId = `dispatch-${row.id}-${row.attempts}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') { await existing.retry(); continue; }
      if (state !== 'completed') continue;
      await existing.remove();
    }
    await queue.add('campaign.dispatch.recipient',row,{ jobId,attempts: 1,removeOnComplete: { count: 1000 },removeOnFail: { count: 1000 } });
  }
}
export function parseDispatchJob(data: unknown): DispatchJob {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid dispatch job');
  const value = data as Record<string,unknown>;
  if (Object.keys(value).length !== 3 || typeof value.id !== 'string' || !uuid.test(value.id) || typeof value.workspace_id !== 'string' || !uuid.test(value.workspace_id) || !Number.isInteger(value.attempts) || (value.attempts as number)<0 || (value.attempts as number)>5) throw new Error('Invalid dispatch job');
  return { id: value.id,workspace_id: value.workspace_id,attempts: value.attempts as number };
}
