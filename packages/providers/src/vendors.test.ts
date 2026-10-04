import { createHmac } from 'node:crypto';
import twilio from 'twilio';
import { describe, expect, it, vi } from 'vitest';
import { InfobipProvider, TwilioProvider, SinchProvider, ZenviaProvider, documentedProviderRegistry } from './index.js';
import type { Credentials, ProviderContext } from './contracts.js';
const connectionId = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-10-04T12:00:00Z');
const credentials = {
  infobip: { apiKey: 'local-test-only', baseHost: 'fixture.api.infobip.com', sender: 'sender',webhookUsername:'fixture',webhookPassword:'local-only-webhook-password'.repeat(3) },
  twilio: { accountSid: `AC${'a'.repeat(32)}`, authToken: 'local-test-only', sender: 'sender', webhookUrl: `https://example.com/webhooks/rcs/twilio?connectionId=${connectionId}` },
  sinch: { projectId: 'project', appId: 'app', keyId: 'key', keySecret: 'local-test-only', region: 'eu', webhookSecret: 'local-only-secret'.repeat(4) },
  zenvia: { apiToken: 'local-test-only', sender: 'sender', subscriptionId: 'subscription', webhookToken: 'local-only-secret'.repeat(4) },
} as const;
const context = (c: Credentials): ProviderContext => ({ workspaceId: 'workspace', connectionId, environment: 'test', credentials: c, signal: new AbortController().signal });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe('documented vendor adapters without external requests', () => {
  it('Sinch registers asynchronous capability requests and accepts only bound conclusive results',async()=>{
    const id='22222222-2222-4222-8222-222222222222';const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({app_id:'app',request_id:id}));const provider=new SinchProvider(fetcher);const ctx=context(credentials.sinch);
    expect(await provider.requestEligibility(ctx,'+5511999999999',id)).toBe(true);expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({app_id:'app',request_id:id,recipient:{identified_by:{channel_identities:[{channel:'RCS',identity:'5511999999999'}]}}});
    const value={project_id:'project',app_id:'app',capability_notification:{request_id:id,channel:'RCS',identity:'5511999999999',capability_status:'CAPABILITY_FULL'}};
    expect(provider.normalizeEligibility(ctx,value)).toEqual({requestId:id,recipient:'+5511999999999',eligible:true});
    expect(provider.normalizeEligibility(ctx,{...value,app_id:'foreign'})).toBeNull();
    for(const [status,eligible] of [['NO_CAPABILITY',false],['CAPABILITY_PARTIAL',null],['CAPABILITY_UNKNOWN',null]] as const)expect(provider.normalizeEligibility(ctx,{...value,capability_notification:{...value.capability_notification,capability_status:status}})?.eligible).toBe(eligible);
    fetcher.mockResolvedValueOnce(response({app_id:'other',request_id:id}));expect(await provider.requestEligibility(ctx,'+5511999999999',id)).toBe(false);
  });
  it('Twilio creates documented Content resources before sending their SID and rejects incompatible carousel layouts',async()=>{
    const sid=`HX${'d'.repeat(32)}`;const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({sid,account_sid:credentials.twilio.accountSid})).mockResolvedValueOnce(response({sid:`SM${'b'.repeat(32)}`,account_sid:credentials.twilio.accountSid,from:'rcs:sender',to:'rcs:+5511999999999',status:'queued'}));const provider=new TwilioProvider(fetcher);const ctx=context(credentials.twilio);
    expect(await provider.send(ctx,{agentId:'sender',recipient:'+5511999999999',idempotencyKey:'key',message:{type:'text',text:'Hello',suggestions:[{type:'reply',text:'Yes',payload:'yes'}]}})).toMatchObject({accepted:true});
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://content.twilio.com/v1/Content');expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).types['twilio/card']).toMatchObject({body:'Hello',actions:[{type:'QUICK_REPLY',title:'Yes',id:'yes',chip_list:true}]});
    const body=new URLSearchParams(String(fetcher.mock.calls[1]![1]?.body));expect(body.get('ContentSid')).toBe(sid);expect(body.has('Body')).toBe(false);
    expect(await provider.send(ctx,{agentId:'sender',recipient:'+5511999999999',idempotencyKey:'key',message:{type:'carousel',cards:[{title:'A',body:'B'},{title:'C',body:'D'}]}})).toMatchObject({accepted:false,error:{code:'invalid_message'}});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('maps Zenvia structured cards and carousel media to documented fields and rejects private URLs',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({id:'id',from:'sender',to:'5511999999999',channel:'rcs'}));const provider=new ZenviaProvider(fetcher);const ctx={...context(credentials.zenvia),resolveMedia:async()=>({url:'https://app.example.test/provider-media/token',mimeType:'image/png',byteSize:100})};const card={title:'Offer',body:'Details',media:{assetId:'private-id',mimeType:'image/png'},suggestions:[{type:'reply' as const,text:'Yes',payload:'yes'}]};
    expect(await provider.send(ctx,{agentId:'sender',recipient:'+5511999999999',idempotencyKey:'key',message:{type:'carousel',cards:[card,card]}})).toMatchObject({accepted:true});const body=JSON.parse(String(fetcher.mock.calls[0]![1]?.body));expect(body.contents[0]).toMatchObject({type:'carousel',cardWidth:'MEDIUM',cards:[{title:'Offer',text:'Details',media:{url:'https://app.example.test/provider-media/token'},buttons:[{type:'text',payload:'yes'}]},{title:'Offer'}]});expect(JSON.stringify(body)).not.toContain('private-id');
    expect(await provider.send({...ctx,resolveMedia:undefined},{agentId:'sender',recipient:'+5511999999999',idempotencyKey:'key',message:{type:'rich_card',card}})).toMatchObject({accepted:false,error:{code:'invalid_message'}});expect(fetcher).toHaveBeenCalledOnce();
  });
  it('Infobip checks the exact recipient synchronously and authenticates bound callback batches',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({capabilityCheckResults:[{phoneNumber:'5511999999999',code:'ENABLED'}]}));
    const provider=new InfobipProvider(fetcher,()=>now);const ctx=context(credentials.infobip);
    expect(await provider.checkEligibility(ctx,'+5511999999999')).toBe(true);
    expect(String(fetcher.mock.calls[0]![0])).toContain('/rcs/2/capability-check/query');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({sender:'sender',phoneNumbers:['5511999999999']});
    for(const [code,expected] of [['UNREACHABLE',false],['REQUEST_FAILED',null],['REJECTED_NETWORK',null]] as const){fetcher.mockResolvedValueOnce(response({capabilityCheckResults:[{phoneNumber:'5511999999999',code}]}));expect(await provider.checkEligibility(ctx,'+5511999999999')).toBe(expected);}
    const event={sender:'sender',to:'5511999999999',messageId:'message-id',doneAt:new Date(now).toISOString(),status:{groupName:'DELIVERED'}};
    const request={headers:{authorization:`Basic ${Buffer.from(`${credentials.infobip.webhookUsername}:${credentials.infobip.webhookPassword}`).toString('base64')}`},rawBody:Buffer.from(JSON.stringify({results:[event]}))};
    expect(await provider.verifyWebhook(ctx,request)).toBe(true);expect(provider.normalizeEvent(ctx,(await provider.parseWebhook(ctx,request))[0])).toMatchObject({type:'message.delivered'});
    expect(await provider.verifyWebhook(ctx,{...request,headers:{}})).toBe(false);
    expect(await provider.verifyWebhook(ctx,{...request,rawBody:Buffer.from(JSON.stringify({results:[{...event,sender:'other'}]}))})).toBe(false);
    expect(await provider.verifyWebhook(ctx,{...request,rawBody:Buffer.from(JSON.stringify({results:[event,{}]}))})).toBe(false);
  });
  it('exposes five inactive adapters and performs no connection proof', () => { const registry = documentedProviderRegistry(); expect(registry.list()).toHaveLength(5); expect(registry.list().every((d) => !d.active && !d.evidence.checks.connectionTestPassed)).toBe(true); expect(() => registry.resolve('twilio')).toThrow(); });
  const cases = [
    { name: 'infobip', Adapter: InfobipProvider, c: credentials.infobip, result: { messages: [{ messageId: 'id', destination: '5511999999999', status: { groupName: 'PENDING' } }] }, host: 'fixture.api.infobip.com', path: '/rcs/2/messages' },
    { name: 'twilio', Adapter: TwilioProvider, c: credentials.twilio, result: { sid: `SM${'b'.repeat(32)}`, account_sid: credentials.twilio.accountSid, from: 'rcs:sender', to: 'rcs:+5511999999999', status: 'queued' }, host: 'api.twilio.com', path: '/2010-04-01/Accounts/' },
    { name: 'sinch', Adapter: SinchProvider, c: credentials.sinch, result: { message_id: 'id' }, host: 'eu.conversation.api.sinch.com', path: '/v1/projects/project/messages:send' },
    { name: 'zenvia', Adapter: ZenviaProvider, c: credentials.zenvia, result: { id: 'id', from: 'sender', to: '5511999999999', channel: 'rcs' }, host: 'api.zenvia.com', path: '/v2/channels/rcs/messages' },
  ];
  for (const fixture of cases) {
    it(`${fixture.name}: sends documented RCS-only text and does not retry`, async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(fixture.result)); const provider = new fixture.Adapter(fetcher, () => now); const ctx = context(fixture.c);
      expect(await provider.send(ctx, { agentId: provider.getExternalAgentId(fixture.c, 'test'), recipient: '+5511999999999', idempotencyKey: 'stable', message: { type: 'text', text: 'Olá' } })).toMatchObject({ accepted: true });
      expect(fetcher).toHaveBeenCalledTimes(1); const [url, init] = fetcher.mock.calls[0]!; expect(new URL(String(url)).hostname).toBe(fixture.host); expect(new URL(String(url)).pathname).toContain(fixture.path); expect(init?.redirect).toBe('error'); expect(init?.body).not.toContain('SMS'); expect(init?.body).not.toContain('FallbackFrom'); expect(init?.body).not.toContain('MessagingServiceSid');
      if (fixture.name === 'sinch') expect(JSON.parse(String(init?.body)).channel_priority_order).toEqual(['RCS']);
    });
    it(`${fixture.name}: blocks foreign agents, formats and invalid credentials before HTTP`, async () => {
      const fetcher = vi.fn<typeof fetch>(); const provider = new fixture.Adapter(fetcher); const ctx = context(fixture.c); const id = provider.getExternalAgentId(fixture.c, 'test');
      expect(await provider.send(ctx, { agentId: 'other', recipient: '+5511999999999', idempotencyKey: 'key', message: { type: 'text', text: 'hello' } })).toMatchObject({ accepted: false });
      expect(await provider.send(ctx, { agentId: id, recipient: '+5511999999999', idempotencyKey: 'key', message: { type: 'file',media:{assetId:'asset',mimeType:'application/pdf'} } })).toMatchObject({ accepted: false, error: { code: 'unsupported_capability' } });
      expect(provider.validateCredentials({ ...fixture.c, unexpected: 'x' }, 'test')).toBe(false); expect(provider.validateCredentials(fixture.c, 'production')).toBe(false); expect(fetcher).not.toHaveBeenCalled(); expect((await provider.listAgents(ctx))[0]?.status).toBe('pending');
    });
    it(`${fixture.name}: sanitizes ambiguous responses and errors`, async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ secret: 'MUST-NOT-LEAK' })); const provider = new fixture.Adapter(fetcher); const ctx = context(fixture.c); const request = { agentId: provider.getExternalAgentId(fixture.c, 'test'), recipient: '+5511999999999', idempotencyKey: 'key', message: { type: 'text' as const, text: 'hello' } };
      expect(await provider.send(ctx, request)).toMatchObject({ accepted: false, error: { code: 'unknown' } }); fetcher.mockResolvedValue(response({ secret: 'MUST-NOT-LEAK' }, 401)); const result = await provider.send(ctx, request); expect(result).toMatchObject({ accepted: false, error: { code: 'invalid_credentials' } }); expect(JSON.stringify(result)).not.toContain('MUST-NOT-LEAK');
    });
  }
  it('rejects non-vendor Infobip hosts and unsigned callbacks', async () => { const p = new InfobipProvider(); expect(p.validateCredentials({ ...credentials.infobip, baseHost: '127.0.0.1' }, 'test')).toBe(false); expect(p.validateCredentials({ ...credentials.infobip, baseHost: 'api.infobip.com.evil.example' }, 'test')).toBe(false); expect(await p.verifyWebhook(context(credentials.infobip), { rawBody: Buffer.from('{}'), headers: {} })).toBe(false); });
  it('Twilio uses the official SDK signature and rejects altered body, account, binding and duplicate fields', async () => {
    const p = new TwilioProvider(undefined, () => now); const ctx = context(credentials.twilio); const body = { AccountSid: credentials.twilio.accountSid, MessageSid: `SM${'b'.repeat(32)}`, MessageStatus: 'read', From: 'rcs:sender', To: 'rcs:+5511999999999' }; const signature = twilio.getExpectedTwilioSignature(credentials.twilio.authToken, credentials.twilio.webhookUrl, body); const request = { rawBody: Buffer.from(new URLSearchParams(body).toString()), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature } };
    expect(await p.verifyWebhook(ctx, request)).toBe(true); expect(p.normalizeEvent(ctx, (await p.parseWebhook(ctx, request))[0])).toMatchObject({ type: 'message.read', providerMessageId: body.MessageSid }); expect(await p.verifyWebhook(ctx, { ...request, rawBody: Buffer.from(`${request.rawBody}&From=rcs%3Aother`) })).toBe(false); expect(await p.verifyWebhook({ ...ctx, connectionId: 'other' }, request)).toBe(false);
  });
  it('Sinch verifies raw bytes and freshness at ingress, then accepts durable processing after queue delay', async () => {
    let clock = now; const p = new SinchProvider(undefined, () => clock); const ctx = context(credentials.sinch); const rawBody = Buffer.from(JSON.stringify({ project_id: 'project', app_id: 'app', event_time: new Date(now).toISOString(), message_delivery_report: { message_id: 'message', status: 'READ', channel_identity: { channel: 'RCS', identity: '5511999999999' } } })); const timestamp = String(now / 1000); const nonce = 'nonce'; const signature = createHmac('sha256', credentials.sinch.webhookSecret).update(rawBody).update(`.${nonce}.${timestamp}`).digest('base64'); const request = { rawBody, headers: { 'x-sinch-webhook-signature-timestamp': timestamp, 'x-sinch-webhook-signature-nonce': nonce, 'x-sinch-webhook-signature-algorithm': 'HmacSHA256', 'x-sinch-webhook-signature': signature } };
    expect(await p.verifyWebhook(ctx, request)).toBe(true); clock += 600000; expect(await p.verifyWebhook(ctx, request)).toBe(false); expect(p.normalizeEvent(ctx, (await p.parseWebhook(ctx, request))[0])).toMatchObject({ type: 'message.read' }); expect(await p.parseWebhook(ctx, { ...request, rawBody: Buffer.concat([rawBody, Buffer.from(' ')]) })).toEqual([]);
  });
  it('Zenvia validates configured subscription token, channel and sender', async () => { const p = new ZenviaProvider(); const ctx = context(credentials.zenvia); const body = { id: 'event', subscriptionId: 'subscription', type: 'MESSAGE_STATUS', channel: 'rcs', message: { id: 'message', direction: 'OUT', from: 'sender', to: '5511999999999' }, messageStatus: { code: 'DELIVERED', timestamp: new Date(now).toISOString() } }; const request = { rawBody: Buffer.from(JSON.stringify(body)), headers: { 'x-rcs-webhook-token': credentials.zenvia.webhookToken } }; expect(await p.verifyWebhook(ctx, request)).toBe(true); expect(await p.verifyWebhook(ctx, { ...request, rawBody: Buffer.from(JSON.stringify({ ...body, subscriptionId: 'foreign' })) })).toBe(false); expect(await p.verifyWebhook(ctx, { ...request, headers: {} })).toBe(false); expect(p.normalizeEvent(ctx, body)).toMatchObject({ type: 'message.delivered' }); });
});
