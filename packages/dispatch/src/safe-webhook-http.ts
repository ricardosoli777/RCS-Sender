import { resolve4 } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
export type WebhookConfig = { url: string; authorization: string };
export function validWebhookConfig(input: unknown): input is WebhookConfig {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some((key) => !['url','authorization'].includes(key))) return false;
  const config = input as WebhookConfig;
  if (typeof config.url!=='string' || config.url.length>2048 || typeof config.authorization!=='string' || config.authorization.length>4096 || /[\r\n\x00]/.test(config.authorization)) return false;
  try { const url = new URL(config.url); return url.protocol==='https:' && !url.username && !url.password && !url.hash && (!url.port || url.port==='443') && !isIP(url.hostname.replace(/^\[|\]$/g,'')) && url.hostname.includes('.') && !/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname); } catch { return false; }
}
export function publicIpv4(address: string) {
  if (isIP(address)!==4) return false; const [a,b,c] = address.split('.').map(Number) as [number,number,number,number];
  return !(a===0 || a===10 || a===127 || a>=224 || a===100 && b>=64 && b<=127 || a===169 && b===254 || a===172 && b>=16 && b<=31 || a===192 && (b===168 || b===0 || b===2 || b===88 && c===99) || a===198 && (b===18 || b===19 || b===51 && c===100) || a===203 && b===0 && c===113);
}
export function withAbort<T>(task: Promise<T>,signal: AbortSignal): Promise<T> { return new Promise((resolve,reject) => { const abort = () => reject(new Error('Operation aborted')); task.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort)); if (signal.aborted) { abort(); return; } signal.addEventListener('abort',abort,{ once: true }); }); }
/** Resolve once, reject non-public addresses and pin that IPv4 at the TLS socket. No redirects. */
export async function postWebhook(config: WebhookConfig,payload: string,idempotencyKey: string,signal: AbortSignal): Promise<number> {
  if (!validWebhookConfig(config) || Buffer.byteLength(payload)>16384) throw new Error('Invalid webhook');
  const url = new URL(config.url); const addresses = await withAbort(resolve4(url.hostname),signal); if (!addresses.length || addresses.some((address) => !publicIpv4(address))) throw new Error('Non-public destination'); const address = addresses[0]!; signal.throwIfAborted();
  return new Promise((resolve,reject) => {
    const req = request(url,{ method: 'POST',agent: false,family: 4,rejectUnauthorized: true,signal,maxHeaderSize: 16384,lookup: (_host,_options,callback) => callback(null,address,4),headers: { 'content-type': 'application/json','content-length': String(Buffer.byteLength(payload)),'x-rcs-idempotency-key': idempotencyKey,...(config.authorization ? { authorization: config.authorization } : {}) } },(response) => {
      let bytes = 0; response.on('data',(chunk: Buffer) => { bytes+=chunk.length; if (bytes>65536) req.destroy(new Error('Response too large')); }); response.once('end',() => resolve(response.statusCode ?? 0)); response.once('error',reject); response.once('aborted',() => reject(new Error('Response aborted')));
    }); req.once('error',reject); req.end(payload);
  });
}
