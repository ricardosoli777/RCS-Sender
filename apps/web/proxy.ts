import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { trustedApiHeaders } from './app/security/trusted-proxy';

export function proxy(request: NextRequest) {
  try { trustedApiHeaders(request.headers); }
  catch { return NextResponse.json({ message: 'Proxy indisponível.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  const nonce = randomBytes(32).toString('base64');
  const development = process.env.NODE_ENV === 'development';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)']
};
