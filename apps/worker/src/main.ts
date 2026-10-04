import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { loadServerConfig } from '@rcs/config';
import { createLogger } from '@rcs/observability';
import { DatabasePool,SimulationOutbox } from '@rcs/database';
import { publishSimulationJobs } from './simulation-relay.js';
import { createDispatchRuntime } from '@rcs/dispatch';
import { documentedProviderRegistry } from '@rcs/providers';
import { CredentialCipher } from '@rcs/security';
import { publishDispatchJobs } from './dispatch-relay.js';
import { createJobHandler } from './job-handler.js';
import { EventBus } from '@rcs/dispatch';
import { publishEventJobs } from './events-relay.js';
import { JourneyRuntime,ScoringService,InboxService } from '@rcs/dispatch';
import { publishJourneyJobs } from './journey-relay.js';
import { WebhookActions } from '@rcs/dispatch';
import { publishWebhookJobs } from './webhook-relay.js';
import { JourneyEntries } from '@rcs/dispatch';
import { publishEntryJobs } from './entry-relay.js';

const config = loadServerConfig(process.env);
const log = createLogger('worker');
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const producerConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
connection.on('error',()=>log.error({code:'REDIS_CONSUMER_FAILED'},'worker Redis unavailable'));
producerConnection.on('error',()=>log.error({code:'REDIS_PRODUCER_FAILED'},'relay Redis unavailable'));
const db = new DatabasePool({ connectionString: config.DATABASE_URL,connectionTimeoutMillis: 10000,query_timeout: 10000 });
const outbox = new SimulationOutbox(db);
const cipher = config.RCS_CREDENTIAL_KEYS && config.RCS_CREDENTIAL_ACTIVE_KEY
  ? new CredentialCipher(config.RCS_CREDENTIAL_ACTIVE_KEY,Object.fromEntries(Object.entries(config.RCS_CREDENTIAL_KEYS).map(([version,hex]) => [version,Buffer.from(hex,'hex')]))) : undefined;
const registry = documentedProviderRegistry();
const dispatch = createDispatchRuntime(db,registry,cipher,Date.now,config.APP_URL);
const events = new EventBus(db,registry,cipher);
const webhooks = new WebhookActions(db,cipher);
const journeys = new JourneyRuntime(db,registry,events,Date.now,webhooks);
const scoring = new ScoringService(db,events);
const inbox = new InboxService(db,events,cipher);
const entries = new JourneyEntries(db,events);
const shutdownSignal = new AbortController();
const instanceId=randomUUID();
const queue = new Queue('rcs-jobs', { connection: producerConnection });
const worker = new Worker('rcs-jobs',createJobHandler(outbox,dispatch,shutdownSignal.signal,events,journeys,scoring,inbox,webhooks,entries), { connection,concurrency: 2 });

let closing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let publishing: Promise<void> = Promise.resolve();
function poll() {
  let degraded=false;
  publishing = Promise.all([
    publishSimulationJobs(outbox,queue).catch(() => { degraded=true; log.error({ code: 'SIMULATION_RELAY_FAILED' },'simulation relay unavailable'); }),
    publishDispatchJobs(dispatch,queue).catch(() => { degraded=true; log.error({ code: 'DISPATCH_RELAY_FAILED' },'dispatch relay unavailable'); }),
    publishEventJobs(events,queue).catch(() => { degraded=true; log.error({ code: 'EVENT_RELAY_FAILED' },'event relay unavailable'); }),
    publishWebhookJobs(webhooks,queue).catch(() => { degraded=true; log.error({ code: 'WEBHOOK_RELAY_FAILED' },'webhook relay unavailable'); }),
    publishEntryJobs(entries,queue).catch(() => { degraded=true; log.error({ code: 'ENTRY_RELAY_FAILED' },'entry relay unavailable'); }),
    publishJourneyJobs(journeys,queue).catch(() => { degraded=true; log.error({ code: 'JOURNEY_RELAY_FAILED' },'journey relay unavailable'); })
  ]).then(async () => { await db.query('INSERT INTO worker_heartbeats(instance_id,status) VALUES($1,$2) ON CONFLICT(instance_id) DO UPDATE SET last_seen_at=now(),status=EXCLUDED.status',[instanceId,degraded ? 'degraded' : 'healthy']); }).catch(() => { log.error({ code:'HEARTBEAT_FAILED' },'worker heartbeat unavailable'); }).finally(() => { if (!closing) timer = setTimeout(poll,2000); });
}
poll();

worker.on('failed', (job) => log.error({ jobId: job?.id,code: 'JOB_FAILED' }, 'job failed'));
worker.on('error', () => log.error({ code:'WORKER_ERROR' }, 'worker error'));

async function shutdown() {
  if (closing) return;
  closing = true; clearTimeout(timer);
  shutdownSignal.abort();
  await publishing;
  await worker.close();
  await queue.close();
  await db.query("UPDATE worker_heartbeats SET status='stopped',last_seen_at=now() WHERE instance_id=$1",[instanceId]).catch(() => {});
  await db.end();
  connection.disconnect();
  producerConnection.disconnect();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
log.info('worker started');
