import { describe, expect, it } from 'vitest';
import { createLogger } from './index.js';

describe('sensitive log redaction', () => {
  it('hides root secrets, nested secrets and session headers while retaining useful fields', () => {
    const lines: string[] = [];
    const logger = createLogger('test', { write: (line) => { lines.push(line); } });
    logger.error({ password: 'root-password', token: 'root-token', apiKey: 'root-api-key',
      secret: 'root-secret', credentials: { value: 'root-credentials' },
      details: { password: 'nested-password', token: 'nested-token', secret: 'nested-secret' },
      req: { headers: { cookie: 'request-session', authorization: 'bearer-secret',
        'x-rcs-edge-token': 'edge-secret', 'x-rcs-proxy-token': 'proxy-secret' } },
      res: { headers: { 'set-cookie': 'response-session' } }, code: 'SERVICE_ERROR' }, 'Request failed');
    expect(lines).toHaveLength(1);
    for (const secret of ['root-password', 'root-token', 'root-api-key', 'root-secret', 'root-credentials',
      'nested-password', 'nested-token', 'nested-secret', 'request-session', 'bearer-secret', 'response-session', 'edge-secret', 'proxy-secret']) {
      expect(lines[0]).not.toContain(secret);
    }
    expect(JSON.parse(lines[0]!)).toMatchObject({ component: 'test', code: 'SERVICE_ERROR',
      password: '[REDACTED]', res: { headers: { 'set-cookie': '[REDACTED]' } } });
  });
});
