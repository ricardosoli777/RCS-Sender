import { defineConfig } from '@playwright/test';

const appUrl = 'http://127.0.0.1:3100';
const apiUrl = 'http://127.0.0.1:3101';

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, retries: 0,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: appUrl, browserName: 'chromium', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: [
    { command: 'pnpm --filter @rcs/api exec node dist/main.js', url: `${apiUrl}/health/ready`, reuseExistingServer: false,
      env: { NODE_ENV: 'test', APP_URL: appUrl, API_URL: apiUrl, API_PORT: '3101', LOG_LEVEL: 'silent' } },
    { command: 'pnpm --filter @rcs/web exec next start --hostname 127.0.0.1 --port 3100', url: `${appUrl}/login`, reuseExistingServer: false,
      env: { NODE_ENV: 'production', API_URL: apiUrl } }
  ]
});
