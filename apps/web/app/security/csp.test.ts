import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../../proxy';

afterEach(() => vi.unstubAllEnvs());

describe('page content security policy', () => {
  it('generates a fresh nonce and overwrites client-supplied policies in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RCS_EDGE_PROXY_SECRET', 'a'.repeat(64));
    vi.stubEnv('RCS_API_PROXY_SECRET', 'b'.repeat(64));
    const request = new NextRequest('https://app.example.test/login', {
      headers: { 'x-rcs-edge-token': 'a'.repeat(64), 'x-rcs-client-ip': '192.0.2.10',
        'x-nonce': 'forged', 'Content-Security-Policy': "script-src 'unsafe-inline'" }
    });
    const first = proxy(request);
    const policy = first.headers.get('content-security-policy')!;
    const nonce = policy.match(/'nonce-([^']+)'/)![1]!;
    expect(Buffer.from(nonce, 'base64')).toHaveLength(32);
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|forged/);
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(proxy(request).headers.get('content-security-policy')).not.toBe(policy);
  });
});
