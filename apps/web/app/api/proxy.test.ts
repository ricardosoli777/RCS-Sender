import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from './[...path]/route';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const uuid = 'a3a89226-3aef-4fc8-b5e6-12fae6ed1149';

describe('same-origin API proxy', () => {
  it('forwards only approved routes and security headers, preserving the HttpOnly cookie', async () => {
    vi.stubEnv('API_URL', 'http://127.0.0.1:3001');
    const fetch = vi.fn(async () => new Response('{"user":{}}', { headers: {
      'Content-Type': 'application/json', 'Set-Cookie': 'rcs_session=test; HttpOnly; SameSite=Strict'
    } }));
    vi.stubGlobal('fetch', fetch);
    const request = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'x-rcs-request': '1',
        'content-type': 'application/json', 'x-forwarded-for': 'trusted-looking-spoof', cookie: 'existing=test' },
      body: '{"email":"user@example.test","password":"test"}'
    });
    const response = await POST(request, { params: Promise.resolve({ path: ['auth', 'login'] }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('http://127.0.0.1:3001/auth/login');
    expect((options.headers as Headers).get('origin')).toBe('http://localhost:3000');
    expect((options.headers as Headers).get('x-forwarded-for')).toBeNull();
  });

  it('rejects arbitrary paths, traversal, invalid workspace ids and excessive bodies before contacting the API', async () => {
    vi.stubEnv('API_URL', 'http://127.0.0.1:3001');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const path of [['admin', 'audit'], ['http:', 'evil.test'], ['workspaces', '..', 'members'], ['workspaces', 'invalid', 'context']]) {
      const response = await GET(new NextRequest('http://localhost:3000/api/test'), { params: Promise.resolve({ path }) });
      expect(response.status).toBe(404);
    }
    const response = await POST(new NextRequest('http://localhost:3000/api/auth/register', { method: 'POST', body: 'a'.repeat(8193) }),
      { params: Promise.resolve({ path: ['auth', 'register'] }) });
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards PATCH with its original body and returns a safe error when the upstream is unavailable', async () => {
    vi.stubEnv('API_URL', 'http://127.0.0.1:3001');
    const fetch = vi.fn(async () => { throw new Error('sensitive internal detail'); });
    vi.stubGlobal('fetch', fetch);
    const response = await PATCH(new NextRequest(`http://localhost:3000/api/workspaces/${uuid}/members/${uuid}`, {
      method: 'PATCH', body: '{"role":"viewer"}'
    }), { params: Promise.resolve({ path: ['workspaces', uuid, 'members', uuid] }) });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sensitive internal detail');
    const options = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(options[1].body).toBe('{"role":"viewer"}');
  });
});
