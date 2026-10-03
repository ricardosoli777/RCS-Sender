import { afterEach, describe, expect, it, vi } from 'vitest';
import { trustedApiHeaders } from './trusted-proxy';

afterEach(() => vi.unstubAllEnvs());

describe('authenticated edge proxy', () => {
  it('forwards only the authenticated client IP with a separate API secret', () => {
    vi.stubEnv('RCS_EDGE_PROXY_SECRET', 'a'.repeat(64));
    vi.stubEnv('RCS_API_PROXY_SECRET', 'b'.repeat(64));
    const headers = new Headers({ 'x-rcs-edge-token': 'a'.repeat(64), 'x-rcs-client-ip': '192.0.2.10',
      'x-forwarded-for': '203.0.113.55', 'x-rcs-proxy-token': 'forged' });
    expect(trustedApiHeaders(headers)).toEqual({ 'x-forwarded-for': '192.0.2.10', 'x-rcs-proxy-token': 'b'.repeat(64) });
    for (const ip of ['192.0.2.10, 192.0.2.11', 'invalid', 'fe80::1%eth0', '']) {
      headers.set('x-rcs-client-ip', ip);
      expect(() => trustedApiHeaders(headers)).toThrow('Proxy não autorizado');
    }
    headers.set('x-rcs-client-ip', '192.0.2.10');
    headers.set('x-rcs-edge-token', 'b'.repeat(64));
    expect(() => trustedApiHeaders(headers)).toThrow('Proxy não autorizado');
  });
  it('fails closed with missing production configuration', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RCS_EDGE_PROXY_SECRET', ''); vi.stubEnv('RCS_API_PROXY_SECRET', '');
    expect(() => trustedApiHeaders(new Headers())).toThrow('Configuração de proxy inválida');
  });
});
