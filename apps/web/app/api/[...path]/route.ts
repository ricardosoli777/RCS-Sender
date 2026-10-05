import type { NextRequest } from 'next/server';
import { trustedApiHeaders } from '../../security/trusted-proxy';

export const runtime = 'nodejs';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = path.join('/');
  const uuid = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
  const allowed = (request.method === 'POST' && ['auth/login', 'auth/logout', 'auth/register'].includes(target))
    || (['GET','PUT'].includes(request.method) && new RegExp(`^workspaces/${uuid}/journeys/${uuid}/entry-rules$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/journeys/${uuid}/(entry-batches|entry-events)$`).test(target))
    || (['GET','POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/webhook-endpoints$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/(analytics|conversations)$`).test(target))
    || (['GET','PATCH'].includes(request.method) && new RegExp(`^workspaces/${uuid}/conversations/${uuid}$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/conversations/${uuid}/reply-draft$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/journeys/${uuid}/analytics$`).test(target))
    || (['GET','PUT'].includes(request.method) && new RegExp(`^workspaces/${uuid}/scoring$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/contacts/${uuid}/score$`).test(target))
    || (['GET','POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/journeys$`).test(target))
    || (['GET','PUT','DELETE'].includes(request.method) && new RegExp(`^workspaces/${uuid}/journeys/${uuid}$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/journeys/${uuid}/(validate|publish|control)$`).test(target))
    || (['GET','POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/journeys/${uuid}/enrollments$`).test(target))
    || (['GET','POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/contacts/${uuid}/rcs-consents$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/dispatch-preparation$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/dispatch$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/dispatch/(enqueue|control)$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/dispatch-preparation/(prepare|confirm|cancel)$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/simulation$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/simulation/(prepare|step|control|enqueue)$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/campaigns/options$`).test(target))
    || (['GET','POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/campaigns$`).test(target))
    || (['GET','PUT','DELETE'].includes(request.method) && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/review$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/campaigns/${uuid}/cancel$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/messages/provider-options$`).test(target))
    || (['GET','POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/messages$`).test(target))
    || (['GET','PUT','DELETE'].includes(request.method) && new RegExp(`^workspaces/${uuid}/messages/${uuid}$`).test(target))
    || (request.method === 'PATCH' && new RegExp(`^workspaces/${uuid}/messages/${uuid}/status$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/messages/${uuid}/versions/[1-9][0-9]{0,8}$`).test(target))
    || (['GET','POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/media$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/media/${uuid}/content$`).test(target))
    || (['GET', 'POST'].includes(request.method) && new RegExp(`^workspaces/${uuid}/contacts$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/contacts/(import|${uuid}/opt-out)$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/contact-lists$`).test(target))
    || (request.method === 'DELETE' && new RegExp(`^workspaces/${uuid}/contact-lists/${uuid}$`).test(target))
    || (request.method === 'GET' && ['auth/me', 'workspaces'].includes(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/(context|audit|members|operations)$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/operations/(requeue|rotate-cipher|compact-history)$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/members$`).test(target))
    || (['PATCH', 'DELETE'].includes(request.method) && new RegExp(`^workspaces/${uuid}/members/${uuid}$`).test(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/providers(?:/catalog)?$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/providers$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/providers/${uuid}/test$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/providers/${uuid}/eligibility$`).test(target))
    || (request.method === 'PUT' && new RegExp(`^workspaces/${uuid}/providers/${uuid}/credentials$`).test(target));
  if (!allowed) return Response.json({ message: 'Rota não encontrada.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (!process.env.API_URL) throw new Error('API_URL ausente');
    const api = new URL(process.env.API_URL);
    if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password
      || api.pathname !== '/' || api.search || api.hash) throw new Error('API_URL inválida');
    const headers = new Headers(trustedApiHeaders(request.headers));
    for (const name of ['cookie', 'content-type', 'origin', 'x-rcs-request']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Forward only the single client IP authenticated by the configured edge proxy.
    let body: string | undefined;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    signal.throwIfAborted();
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > (target.endsWith('/media') ? 3*1024*1024 : target.includes('/journeys/') && request.method === 'PUT' ? 262144 : target.endsWith('/contacts/import') ? 131072 : (target.includes('/providers') || target.includes('/messages')) ? 65536 : 8192)) {
            cancel();
            return Response.json({ message: 'Requisição muito grande.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
          }
          chunks.push(chunk.value);
        }
      } finally {
        signal.removeEventListener('abort', cancel);
        reader.releaseLock();
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    const upstream = new URL(`/${target}`, api);
    if (request.method === 'GET' && (target.endsWith('/contacts') || target.endsWith('/media') || target.endsWith('/messages') || target.endsWith('/campaigns') || target.endsWith('/journeys') || target.endsWith('/enrollments') || target.endsWith('/score') || target.endsWith('/conversations') || new RegExp(`^workspaces/${uuid}/conversations/${uuid}$`).test(target) || target.endsWith('/campaigns/options')) && request.nextUrl.searchParams.has('offset')) {
      const offset = request.nextUrl.searchParams.get('offset')!;
      if (!/^(0|[1-9][0-9]{0,6})$/.test(offset)) return Response.json({ message: 'Dados inválidos.' }, { status: 400 });
      upstream.searchParams.set('offset', offset);
    }
    if (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/journeys/${uuid}(?:/analytics)?$`).test(target) && request.nextUrl.searchParams.has('version')) {
      const version = request.nextUrl.searchParams.get('version')!;
      if (!/^[1-9][0-9]{0,6}$/.test(version)) return Response.json({ message: 'Dados inválidos.' },{ status: 400,headers: { 'Cache-Control': 'no-store' } });
      upstream.searchParams.set('version',version);
    }
    if (request.method === 'GET' && target.endsWith('/messages') && request.nextUrl.searchParams.has('status')) {
      const status = request.nextUrl.searchParams.get('status')!;
      if (!['draft','active','archived'].includes(status)) return Response.json({ message: 'Dados inválidos.' },{ status: 400,headers: { 'Cache-Control': 'no-store' } });
      upstream.searchParams.set('status',status);
    }
    if (request.method === 'GET' && target.endsWith('/campaigns') && request.nextUrl.searchParams.has('status')) {
      const status = request.nextUrl.searchParams.get('status')!;
      if (!['draft','scheduled','ready','queued','running','paused','completed','cancelled','failed'].includes(status)) return Response.json({ message: 'Dados inválidos.' },{ status: 400,headers: { 'Cache-Control': 'no-store' } });
      upstream.searchParams.set('status',status);
    }
    if (request.method === 'GET' && target.endsWith('/campaigns/options')) {
      const kind = request.nextUrl.searchParams.get('kind') ?? '';
      if (!['connections','audiences','messages'].includes(kind)) return Response.json({ message: 'Dados inválidos.' },{ status: 400,headers: { 'Cache-Control': 'no-store' } });
      upstream.searchParams.set('kind',kind);
    }
    const response = await fetch(upstream, {
      method: request.method, headers, redirect: 'manual', cache: 'no-store',
      ...(body === undefined ? {} : { body }),
      signal
    });
    const output = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition', 'set-cookie', 'retry-after', 'x-content-type-options']) {
      const value = response.headers.get(name);
      if (value) output.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: output });
  } catch {
    return Response.json({ message: 'Serviço temporariamente indisponível.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
