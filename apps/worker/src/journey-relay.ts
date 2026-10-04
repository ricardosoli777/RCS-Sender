import type { Queue } from 'bullmq';
import type { JourneyJob } from '@rcs/dispatch';
export function parseJourneyJob(data: unknown): JourneyJob {
  if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Invalid journey job'); const value = data as Record<string,unknown>; const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (Object.keys(value).length!==3 || typeof value.enrollment_id!=='string' || !uuid.test(value.enrollment_id) || typeof value.workspace_id!=='string' || !uuid.test(value.workspace_id) || !Number.isInteger(value.revision) || Number(value.revision)<1 || Number(value.revision)>2147483647) throw new Error('Invalid journey job');
  return { enrollment_id: value.enrollment_id,workspace_id: value.workspace_id,revision: Number(value.revision) };
}
export async function publishJourneyJobs(runtime: { due(): Promise<JourneyJob[]> },queue: Pick<Queue,'getJob' | 'add'>) {
  for (const job of await runtime.due()) { const jobId = `journey-${job.enrollment_id}-${job.revision}`; const previous = await queue.getJob(jobId); if (previous) { const state = await previous.getState(); if (state==='failed') { await previous.retry(); continue; } if (state!=='completed') continue; await previous.remove(); } await queue.add('journey.step',job,{ jobId,attempts: 1,removeOnComplete: { count: 1000 },removeOnFail: { count: 1000 } }); }
}
