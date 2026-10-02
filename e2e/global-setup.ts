import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup() {
  if (process.env.RUN_SERVICE_TESTS !== '1') throw new Error('E2E exige RUN_SERVICE_TESTS=1 e banco/Redis exclusivos de teste.');
  execFileSync(process.execPath, [resolve('packages/database/dist/migrate.js')], {
    stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', APP_URL: 'http://127.0.0.1:3100', API_URL: 'http://127.0.0.1:3101' }
  });
}
