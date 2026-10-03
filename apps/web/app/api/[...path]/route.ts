import type { NextRequest } from 'next/server';
import { trustedApiHeaders } from '../../security/trusted-proxy';

export const runtime = 'nodejs';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = path.join('/');
  const uuid = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
  const allowed = (request.method === 'POST' && ['auth/login', 'auth/logout', 'auth/register'].includes(target))
    || (request.method === 'GET' && ['auth/me', 'workspaces'].includes(target))
    || (request.method === 'GET' && new RegExp(`^workspaces/${uuid}/(context|audit|members)$`).test(target))
    || (request.method === 'POST' && new RegExp(`^workspaces/${uuid}/members$`).test(target))
    || (['PATCH', 'DELETE'].includes(request.method) && new RegExp(`^workspaces/${uuid}/members/${uuid}$`).test(target));
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
          if (bytes > 8192) {
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
    const response = await fetch(new URL(`/${target}`, api), {
      method: request.method, headers, redirect: 'manual', cache: 'no-store',
      ...(body === undefined ? {} : { body }),
      signal
    });
    const output = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'set-cookie', 'retry-after', 'x-content-type-options']) {
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
export const DELETE = proxy;
