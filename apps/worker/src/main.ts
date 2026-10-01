import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { loadServerConfig } from '@rcs/config';
import { createLogger } from '@rcs/observability';

const config = loadServerConfig(process.env);
const log = createLogger('worker');
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('rcs-jobs', { connection });
const worker = new Worker('rcs-jobs', async (job) => {
  if (job.name === 'health.ping') return { status: 'ok' };
  throw new Error(`Tipo de tarefa não implementado: ${job.name}`);
}, { connection });

worker.on('failed', (job, error) => log.error({ jobId: job?.id, err: error }, 'job failed'));
worker.on('error', (error) => log.error({ err: error }, 'worker error'));

async function shutdown() {
  await worker.close();
  await queue.close();
  connection.disconnect();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
log.info('worker started');
