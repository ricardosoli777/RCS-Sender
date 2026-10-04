import type { Queue } from 'bullmq';
import type { EventJob } from '@rcs/dispatch';
export async function publishWebhookJobs(actions: { due(): Promise<EventJob[]> },queue: Pick<Queue,'getJob' | 'add'>) {
  for (const row of await actions.due()) { const jobId=`journey-webhook-${row.id}`; const existing=await queue.getJob(jobId); if (existing) { const state=await existing.getState(); if (state==='failed') { await existing.retry(); continue; } if (state!=='completed') continue; await existing.remove(); } await queue.add('journey.webhook',row,{ jobId,attempts: 1,removeOnComplete: { count: 1000 },removeOnFail: { count: 1000 } }); }
}
