import { defineConfig } from '@playwright/test';

const appUrl = 'http://127.0.0.1:3100';
const apiUrl = 'http://127.0.0.1:3101';
const proxySecrets = { RCS_EDGE_PROXY_SECRET: 'a'.repeat(64), RCS_API_PROXY_SECRET: 'b'.repeat(64) };

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, retries: 0,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: appUrl, browserName: 'chromium', trace: 'off', screenshot: 'off', video: 'off',
    extraHTTPHeaders: { 'x-rcs-edge-token': proxySecrets.RCS_EDGE_PROXY_SECRET, 'x-rcs-client-ip': '192.0.2.10' } },
  webServer: [
    { command: 'pnpm --filter @rcs/api exec node dist/main.js', url: `${apiUrl}/health/ready`, reuseExistingServer: false,
      env: { ...proxySecrets, RCS_CREDENTIAL_KEYS: JSON.stringify({ e2e_fixture: 'c'.repeat(64) }),RCS_CREDENTIAL_ACTIVE_KEY: 'e2e_fixture', NODE_ENV: 'test', APP_URL: appUrl, API_URL: apiUrl, API_PORT: '3101', LOG_LEVEL: 'error' } },
    { command: 'pnpm --filter @rcs/web exec next start --hostname 127.0.0.1 --port 3100', port: 3100, reuseExistingServer: false,
      env: { ...proxySecrets, NODE_ENV: 'production', API_URL: apiUrl } }
  ]
});
