import type { Queue } from 'bullmq';
import type { EventJob } from '@rcs/dispatch';
export function parseEventJob(data:unknown):EventJob {
  const value=data && typeof data==='object' && !Array.isArray(data) ? data as Record<string,unknown> : null;
  if (!value || Object.keys(value).length!==3 || typeof value.id!=='string' || typeof value.workspace_id!=='string' || ![value.id,value.workspace_id].every((id)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) || !Number.isSafeInteger(value.attempts) || Number(value.attempts)<0 || Number(value.attempts)>1000000) throw new Error('Invalid dispatch job');
  return { id:value.id,workspace_id:value.workspace_id,attempts:Number(value.attempts) };
}
export async function publishEventJobs(bus: { due(): Promise<EventJob[]>; pendingCampaignEvents(): Promise<EventJob[]>; pendingJourneyEvents?(): Promise<EventJob[]>; pendingScoringEvents?(): Promise<EventJob[]>; pendingConversationEvents?(): Promise<EventJob[]> },queue: Pick<Queue,'getJob' | 'add'>) {
  for (const [name,prefix,rows] of [['webhook.normalize','webhook',await bus.due()],['event.consume.campaigns','event-campaigns',await bus.pendingCampaignEvents()],['event.consume.journeys','event-journeys',await bus.pendingJourneyEvents?.() ?? []],['event.consume.scoring','event-scoring',await bus.pendingScoringEvents?.() ?? []],['event.consume.conversations','event-conversations',await bus.pendingConversationEvents?.() ?? []]] as const) for (const row of rows) {
    const jobId = `${prefix}-${row.id}-${row.attempts}`; const existing = await queue.getJob(jobId);
    if (existing) { const state = await existing.getState(); if (state === 'failed') { await existing.retry(); continue; } if (state !== 'completed') continue; await existing.remove(); }
    await queue.add(name,row,{ jobId,attempts: 1,removeOnComplete: { count: 1000 },removeOnFail: { count: 1000 } });
  }
}
