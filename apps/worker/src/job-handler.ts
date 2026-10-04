import { parseDispatchJob,type DispatchJob } from './dispatch-relay.js';
import { parseSimulationJob } from './simulation-relay.js';
import type { SimulationJob } from '@rcs/database';
import { parseEventJob } from './events-relay.js';
import type { EventBus } from '@rcs/dispatch';
import type { JourneyRuntime,ScoringService,InboxService,WebhookActions,JourneyEntries } from '@rcs/dispatch';
import { parseJourneyJob } from './journey-relay.js';
export function createJobHandler(simulation: { execute(job: SimulationJob): Promise<string> },dispatch: { execute(job: DispatchJob,signal: AbortSignal): Promise<string> },signal: AbortSignal,events?: Pick<EventBus,'execute' | 'consumeCampaignEvent'>,journeys?: Pick<JourneyRuntime,'execute' | 'consumeEvent'>,scoring?: Pick<ScoringService,'consumeEvent'>,inbox?: Pick<InboxService,'consumeEvent'>,webhooks?: Pick<WebhookActions,'execute'>,entries?: Pick<JourneyEntries,'execute'>) {
  return async (job: { name: string; data: unknown }) => {
    if (job.name === 'health.ping') return { status: 'ok' };
    if (job.name === 'campaign.simulation.batch') return { status: await simulation.execute(parseSimulationJob(job.data)),realSending: false };
    if (job.name === 'campaign.dispatch.recipient') return { status: await dispatch.execute(parseDispatchJob(job.data),signal) };
    if (job.name === 'webhook.normalize' && events) return { status: await events.execute(parseEventJob(job.data)) };
    if (job.name === 'event.consume.campaigns' && events) return { consumed: await events.consumeCampaignEvent(parseEventJob(job.data)) };
    if (job.name === 'journey.step' && journeys) return { status: await journeys.execute(parseJourneyJob(job.data)) };
    if (job.name === 'event.consume.journeys' && journeys) return { consumed: await journeys.consumeEvent(parseEventJob(job.data)) };
    if (job.name === 'event.consume.scoring' && scoring) return { consumed: await scoring.consumeEvent(parseEventJob(job.data)) };
    if (job.name === 'event.consume.conversations' && inbox) return { consumed: await inbox.consumeEvent(parseEventJob(job.data)) };
    if (job.name === 'journey.webhook' && webhooks) return { status: await webhooks.execute(parseEventJob(job.data),signal) };
    if (job.name === 'journey.entry' && entries) return { status: await entries.execute(parseEventJob(job.data)) };
    throw new Error('Tipo de tarefa não implementado');
  };
}
