import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH, PUT } from './[...path]/route';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const uuid = 'a3a89226-3aef-4fc8-b5e6-12fae6ed1149';

describe('same-origin API proxy', () => {
  it('forwards journey graphs, versions and pagination without exposing arbitrary routes',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001'); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({})); vi.stubGlobal('fetch',fetch); const path = ['workspaces',uuid,'journeys',uuid];
    expect((await GET(new NextRequest('http://localhost:3000/api/test?version=2&private=ignored'),{ params: Promise.resolve({ path }) })).status).toBe(200); expect(String(fetch.mock.calls[0]![0])).toBe(`http://127.0.0.1:3001/${path.join('/')}?version=2`);
    expect((await GET(new NextRequest('http://localhost:3000/api/test?offset=50&version=2'),{ params: Promise.resolve({ path: [...path,'enrollments'] }) })).status).toBe(200); expect(String(fetch.mock.calls[1]![0])).toContain('offset=50'); expect(String(fetch.mock.calls[1]![0])).not.toContain('version=');
    expect((await GET(new NextRequest('http://localhost:3000/api/test?version=2'),{ params: Promise.resolve({ path: [...path,'analytics'] }) })).status).toBe(200); expect(String(fetch.mock.calls[2]![0])).toContain('version=2');
    const body = JSON.stringify({ graph: { data: 'x'.repeat(10000) } }); expect((await PUT(new NextRequest('http://localhost:3000/api/test',{ method: 'PUT',body }),{ params: Promise.resolve({ path }) })).status).toBe(200); expect(fetch.mock.calls.at(-1)![1]!.body).toBe(body);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body }),{ params: Promise.resolve({ path: [...path,'publish'] }) })).status).toBe(413); expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path: [...path,'send'] }) })).status).toBe(404);
  });
  it('forwards dispatch summary and explicit enqueue only on approved routes',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001'); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ dispatch: {} })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'campaigns',uuid,'dispatch']; const headers = { cookie: 'rcs_session=fixture',origin: 'http://localhost:3000','x-rcs-request': '1' };
    expect((await GET(new NextRequest('http://localhost:3000/api/test?phone=private'),{ params: Promise.resolve({ path }) })).status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/${path.join('/')}`);
    const body = JSON.stringify({ mode: 'dispatch',expectedRevision: 3,runId: uuid });
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',headers,body }),{ params: Promise.resolve({ path: [...path,'enqueue'] }) })).status).toBe(200);
    const sent = fetch.mock.calls.at(-1)?.[1]; expect(sent?.body).toBe(body); expect(new Headers(sent?.headers).get('cookie')).toBe(headers.cookie); expect(new Headers(sent?.headers).get('x-rcs-request')).toBe('1');
    fetch.mockClear();
    const control=JSON.stringify({expectedRevision:4,action:'pause'});expect((await POST(new NextRequest('http://localhost:3000/api/test',{method:'POST',headers,body:control}),{params:Promise.resolve({path:[...path,'control']})})).status).toBe(200);expect(fetch.mock.calls.at(-1)?.[1]?.body).toBe(control);fetch.mockClear();
    for (const operation of ['send','retry']) expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path: [...path,operation] }) })).status).toBe(404);
    expect((await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path: [...path,'enqueue'] }) })).status).toBe(404);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: 'x'.repeat(8193) }),{ params: Promise.resolve({ path: [...path,'enqueue'] }) })).status).toBe(413); expect(fetch).not.toHaveBeenCalled();
  });
  it('allows consent summaries and records only on approved contact routes',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001'); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ consents: [] })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'contacts',uuid,'rcs-consents'];
    expect((await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path }) })).status).toBe(200);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path }) })).status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/${path.join('/')}`); fetch.mockClear();
    expect((await PATCH(new NextRequest('http://localhost:3000/api/test',{ method: 'PATCH' }),{ params: Promise.resolve({ path }) })).status).toBe(404);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: 'x'.repeat(8193) }),{ params: Promise.resolve({ path }) })).status).toBe(413); expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards only bounded dispatch preparation operations and never a send or enqueue route',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ preparation: { executionAvailable: false } })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'campaigns',uuid,'dispatch-preparation'];
    const headers = { cookie: 'rcs_session=fixture',origin: 'http://localhost:3000','x-rcs-request': '1' };
    const body = JSON.stringify({ mode: 'dispatch',expectedRevision: 2,runId: uuid });
    expect((await GET(new NextRequest('http://localhost:3000/api/test?phone=ignored'),{ params: Promise.resolve({ path }) })).status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/${path.join('/')}`);
    for (const operation of ['prepare','confirm','cancel']) {
      const response = await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',headers,body }),{ params: Promise.resolve({ path: [...path,operation] }) });
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
      const sent = fetch.mock.calls.at(-1)?.[1]; expect(sent?.body).toBe(body); expect(new Headers(sent?.headers).get('cookie')).toBe(headers.cookie); expect(new Headers(sent?.headers).get('x-rcs-request')).toBe('1');
    }
    expect(fetch).toHaveBeenCalledTimes(4); fetch.mockClear();
    for (const operation of ['send','enqueue','step','control']) expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path: [...path,operation] }) })).status).toBe(404);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: 'x'.repeat(8193) }),{ params: Promise.resolve({ path: [...path,'confirm'] }) })).status).toBe(413);
    expect((await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path: [...path,'confirm'] }) })).status).toBe(404);
    expect((await PUT(new NextRequest('http://localhost:3000/api/test',{ method: 'PUT' }),{ params: Promise.resolve({ path }) })).status).toBe(404);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST' }),{ params: Promise.resolve({ path: ['workspaces',uuid,'campaigns','invalid','dispatch-preparation','prepare'] }) })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves binary media and safe download headers and bounds upload bodies', async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001');
    const bytes = new Uint8Array([137,80,78,71,0,255,128]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(bytes,{ headers: { 'content-type': 'image/png','content-disposition': `inline; filename="${uuid}.png"`,'x-content-type-options': 'nosniff' } }));
    vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'media',uuid,'content'];
    const response = await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path }) });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes); expect(response.headers.get('content-disposition')).toContain(uuid);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff'); expect(response.headers.get('cache-control')).toBe('no-store');
    fetch.mockClear();
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: 'a'.repeat(3*1024*1024+1) }),{ params: Promise.resolve({ path: ['workspaces',uuid,'media'] }) })).status).toBe(413);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST' }),{ params: Promise.resolve({ path }) })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards eligibility queries only by POST on a valid connection route', async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ status: 'unknown',reason: 'unsupported' })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'providers',uuid,'eligibility'];
    const response = await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: JSON.stringify({ contactId: uuid }) }),{ params: Promise.resolve({ path }) });
    expect(response.status).toBe(200); expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/workspaces/${uuid}/providers/${uuid}/eligibility`);
    fetch.mockClear();
    expect((await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path }) })).status).toBe(404);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST' }),{ params: Promise.resolve({ path: ['workspaces',uuid,'providers','invalid','eligibility'] }) })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards bounded contact imports and only the validated pagination parameter', async () => {
    vi.stubEnv('API_URL', 'http://127.0.0.1:3001');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ total: 0 })); vi.stubGlobal('fetch', fetch);
    const path = ['workspaces', uuid, 'contacts'];
    expect((await GET(new NextRequest('http://localhost:3000/api/test?offset=100&workspace=forged'), { params: Promise.resolve({ path }) })).status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/workspaces/${uuid}/contacts?offset=100`);
    fetch.mockClear();
    expect((await GET(new NextRequest('http://localhost:3000/api/test?offset=-1'), { params: Promise.resolve({ path }) })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect((await POST(new NextRequest('http://localhost:3000/api/test', { method: 'POST', body: JSON.stringify({ text: '11912345678\n'.repeat(490) }) }), { params: Promise.resolve({ path: [...path, 'import'] }) })).status).toBe(200);
    fetch.mockClear();
    expect((await POST(new NextRequest('http://localhost:3000/api/test', { method: 'POST', body: 'a'.repeat(131073) }), { params: Promise.resolve({ path: [...path, 'import'] }) })).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards message versions and mutations with bounded bodies and validated filters', async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ message: {} })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'messages'];
    await GET(new NextRequest('http://localhost:3000/api/test?offset=50&status=active&secret=ignored'),{ params: Promise.resolve({ path }) });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/workspaces/${uuid}/messages?offset=50&status=active`);
    await PUT(new NextRequest('http://localhost:3000/api/test',{ method: 'PUT',body: '{"expectedVersion":1}' }),{ params: Promise.resolve({ path: [...path,uuid] }) });
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('PUT');
    await PATCH(new NextRequest('http://localhost:3000/api/test',{ method: 'PATCH',body: '{"status":"active","expectedVersion":1}' }),{ params: Promise.resolve({ path: [...path,uuid,'status'] }) });
    await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path: [...path,uuid,'versions','1'] }) });
    expect(fetch).toHaveBeenCalledTimes(4); fetch.mockClear();
    expect((await GET(new NextRequest('http://localhost:3000/api/test?status=invalid'),{ params: Promise.resolve({ path }) })).status).toBe(400);
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: 'a'.repeat(65537) }),{ params: Promise.resolve({ path }) })).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards only GET for builder capability comparison',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001'); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ providers: [] })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'messages','provider-options'];
    expect((await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path }) })).status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/workspaces/${uuid}/messages/provider-options`);
    fetch.mockClear(); expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path }) })).status).toBe(404); expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards campaign drafts, local review and cancellation without execution routes',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001'); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ campaign: {} })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'campaigns'];
    await GET(new NextRequest('http://localhost:3000/api/test?status=draft&offset=50&secret=ignored'),{ params: Promise.resolve({ path }) });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/workspaces/${uuid}/campaigns?offset=50&status=draft`);
    await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path: [...path,uuid,'review'] }) });
    await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{"expectedRevision":1}' }),{ params: Promise.resolve({ path: [...path,uuid,'cancel'] }) });
    expect(fetch).toHaveBeenCalledTimes(3); fetch.mockClear();
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path: [...path,uuid,'send'] }) })).status).toBe(404);
    expect((await GET(new NextRequest('http://localhost:3000/api/test?status=invalid'),{ params: Promise.resolve({ path }) })).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds campaign picker queries and permits only approved option kinds',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001'); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ options: [],total: 0 })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'campaigns','options'];
    expect((await GET(new NextRequest('http://localhost:3000/api/test?kind=messages&offset=50&secret=ignored'),{ params: Promise.resolve({ path }) })).status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/workspaces/${uuid}/campaigns/options?offset=50&kind=messages`);
    fetch.mockClear();
    for (const query of ['kind=credentials','kind=messages&offset=-1','']) expect((await GET(new NextRequest(`http://localhost:3000/api/test?${query}`),{ params: Promise.resolve({ path }) })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path }) })).status).toBe(404);
  });
  it('forwards bounded simulation operations without exposing real sends',async () => {
    vi.stubEnv('API_URL','http://127.0.0.1:3001'); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ simulation: null })); vi.stubGlobal('fetch',fetch);
    const path = ['workspaces',uuid,'campaigns',uuid,'simulation'];
    expect((await GET(new NextRequest('http://localhost:3000/api/test'),{ params: Promise.resolve({ path }) })).status).toBe(200);
    for (const operation of ['prepare','step','control','enqueue']) expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{"expectedRevision":1}' }),{ params: Promise.resolve({ path: [...path,operation] }) })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(5); fetch.mockClear();
    expect((await POST(new NextRequest('http://localhost:3000/api/test',{ method: 'POST',body: '{}' }),{ params: Promise.resolve({ path: [...path,'send'] }) })).status).toBe(404); expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards connection tests only by POST and rejects malformed connection ids', async () => {
    vi.stubEnv('API_URL', 'http://127.0.0.1:3001');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ status: 'connected' })); vi.stubGlobal('fetch', fetch);
    const path = ['workspaces', uuid, 'providers', uuid, 'test'];
    const response = await POST(new NextRequest('http://localhost:3000/api/test', { method: 'POST', body: '{}' }), { params: Promise.resolve({ path }) });
    expect(response.status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3001/workspaces/${uuid}/providers/${uuid}/test`);
    fetch.mockClear();
    expect((await GET(new NextRequest('http://localhost:3000/api/test'), { params: Promise.resolve({ path }) })).status).toBe(404);
    expect((await POST(new NextRequest('http://localhost:3000/api/test', { method: 'POST' }), { params: Promise.resolve({ path: ['workspaces', uuid, 'providers', 'invalid', 'test'] }) })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards bounded credential replacements and rejects secret reads and unsupported provider routes', async () => {
    vi.stubEnv('API_URL', 'http://127.0.0.1:3001');
    const fetch = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
    const path = ['workspaces', uuid, 'providers', uuid, 'credentials'];
    const response = await PUT(new NextRequest('http://localhost:3000/api/test', { method: 'PUT', body: JSON.stringify({ credentials: { apiKey: 'test'.repeat(2500) } }) }), { params: Promise.resolve({ path }) });
    expect(response.status).toBe(204); expect(fetch).toHaveBeenCalledOnce();
    fetch.mockClear();
    expect((await GET(new NextRequest('http://localhost:3000/api/test'), { params: Promise.resolve({ path }) })).status).toBe(404);
    expect((await POST(new NextRequest('http://localhost:3000/api/test', { method: 'POST', body: 'a'.repeat(65537) }), { params: Promise.resolve({ path: ['workspaces', uuid, 'providers'] }) })).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'disconnect'])('cancels a stalled upload on %s before contacting the API', async (reason) => {
    vi.stubEnv('API_URL', 'http://127.0.0.1:3001');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const client = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const requestOptions = {
      method: 'POST', body: stream, signal: client.signal, duplex: 'half' as const
    };
    const request = new NextRequest('http://localhost:3000/api/auth/login', requestOptions);
    const pending = POST(request, { params: Promise.resolve({ path: ['auth', 'login'] }) });
    await Promise.resolve();
    (reason === 'timeout' ? deadline : client).abort();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

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
