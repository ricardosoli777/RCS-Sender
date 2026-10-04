import { EventEmitter } from 'node:events';
import { describe,it,expect,vi,beforeEach } from 'vitest';
import { resolve4 } from 'node:dns/promises';
import { request } from 'node:https';
import { postWebhook,publicIpv4,validWebhookConfig,withAbort } from './safe-webhook-http.js';
vi.mock('node:dns/promises',() => ({ resolve4: vi.fn() }));
vi.mock('node:https',() => ({ request: vi.fn() }));
const config={ url: 'https://hooks.example.com/path',authorization: 'Bearer synthetic-token' };
beforeEach(() => vi.clearAllMocks());
describe('outbound webhook destination controls',() => {
  it('rejects non-HTTPS, credentials, local/IP hosts and alternate ports',() => { expect(validWebhookConfig(config)).toBe(true); for (const url of ['http://hooks.example.com','https://127.0.0.1','https://[::1]','https://2130706433','https://localhost','https://host.local','https://host.internal','https://hooks.example.com:444','https://user:pass@hooks.example.com','https://hooks.example.com/#x']) expect(validWebhookConfig({ ...config,url })).toBe(false); expect(validWebhookConfig({ ...config,authorization: 'Bearer x\r\nx: y' })).toBe(false); });
  it('rejects private, link-local, documentation, multicast and reserved IPv4 ranges',() => { for (const address of ['0.1.2.3','10.1.2.3','127.1.2.3','100.64.1.2','169.254.169.254','172.16.1.1','192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1']) expect(publicIpv4(address)).toBe(false); expect(publicIpv4('8.8.8.8')).toBe(true); });
  it('pins a public address while keeping the HTTPS hostname and does not follow redirects',async () => {
    vi.mocked(resolve4).mockResolvedValue(['8.8.8.8'] as never); const req=new EventEmitter() as EventEmitter & { end(): void }; req.end=() => { const response=new EventEmitter() as EventEmitter & { statusCode: number }; response.statusCode=302; const callback=vi.mocked(request).mock.calls[0]![2] as (response: unknown) => void; callback(response); response.emit('end'); }; vi.mocked(request).mockReturnValue(req as never);
    expect(await postWebhook(config,'{}','attempt-id',new AbortController().signal)).toBe(302); const options=vi.mocked(request).mock.calls[0]![1] as unknown as { family: number; agent: boolean; rejectUnauthorized: boolean; lookup: (host: string,options: object,callback: (error: null,address: string,family: number) => void) => void }; expect(options).toMatchObject({ family: 4,agent: false,rejectUnauthorized: true }); const lookup=vi.fn(); options.lookup('hooks.example.com',{},lookup); expect(lookup).toHaveBeenCalledWith(null,'8.8.8.8',4); expect(String(vi.mocked(request).mock.calls[0]![0])).toBe(config.url); expect(request).toHaveBeenCalledOnce();
  });
  it('does not open a socket if DNS contains a private answer',async () => { vi.mocked(resolve4).mockResolvedValue(['8.8.8.8','127.0.0.1'] as never); await expect(postWebhook(config,'{}','id',new AbortController().signal)).rejects.toThrow('Non-public'); expect(request).not.toHaveBeenCalled(); });
  it('bounds even a transport that ignores cancellation',async () => { const controller=new AbortController(); const waiting=withAbort(new Promise(() => undefined),controller.signal); controller.abort(); await expect(waiting).rejects.toThrow('aborted'); });
});
