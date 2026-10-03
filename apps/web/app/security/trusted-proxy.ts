import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export function trustedApiHeaders(headers: Headers): Record<string, string> {
  const edgeSecret = process.env.RCS_EDGE_PROXY_SECRET;
  const apiSecret = process.env.RCS_API_PROXY_SECRET;
  if (!edgeSecret && !apiSecret && process.env.NODE_ENV !== 'production') return {};
  if (!edgeSecret || !apiSecret || !/^[a-f0-9]{64}$/.test(edgeSecret) || !/^[a-f0-9]{64}$/.test(apiSecret)
    || edgeSecret === apiSecret) throw new Error('Configuração de proxy inválida');
  const token = headers.get('x-rcs-edge-token') ?? '';
  const ip = headers.get('x-rcs-client-ip') ?? '';
  if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(edgeSecret))
    || !isIP(ip) || ip.includes('%')) throw new Error('Proxy não autorizado');
  return { 'x-forwarded-for': ip, 'x-rcs-proxy-token': apiSecret };
}
