import twilio from 'twilio';
import {createHash} from 'node:crypto';
import type { CanonicalEvent, Credentials, ProviderContext, RichCard, Suggestion, SendRequest, SendResult, WebhookRequest } from './contracts.js';
import {capabilityMatrix} from './capabilities.js';
import {imageUrl} from './rich-media.js';
import {actionFields} from './action-correlation.js';
import { VendorHttpError, VendorTextProvider, credentialSchema, validKeys, vendorJson, vendorError, nonempty, phone } from './vendor-http.js';
const keys = ['accountSid', 'authToken', 'sender', 'webhookUrl'] as const;
const statuses: Readonly<Record<string, CanonicalEvent['type']>> = { sent: 'message.sent', delivered: 'message.delivered', read: 'message.read', failed: 'message.failed', undelivered: 'message.failed', received: 'message.received' };
export class TwilioProvider extends VendorTextProvider {
  getProviderCapabilities(){return capabilityMatrix({text:'supported',rich_card:'supported',carousel:'supported',media:'supported',file:'unsupported',suggested_replies:'supported',url_actions:'supported'});}
  getProviderLimits(){return {maxTextCharacters:1000,maxTitleCharacters:200,maxCards:10,maxSuggestions:11};}
  private actions(items:readonly Suggestion[]=[],chipList?:boolean,carousel=false){return items.map(item=>{if(item.text.length>(item.type==='reply'&&!carousel?20:25))throw new VendorHttpError(400);return {type:item.type==='reply'?'QUICK_REPLY':'URL',title:item.text,...(item.type==='reply'?{id:item.payload}:{url:item.url,id:item.url}),...(chipList===undefined?{}:{chip_list:chipList})};});}
  private async card(context:ProviderContext,card:RichCard){if(card.title.length>200 || card.body.length>1600 || (card.suggestions?.length??0)>4)throw new VendorHttpError(400);return {title:card.title,body:card.body,...(card.media?{media:[await imageUrl(context,card.media)],orientation:'VERTICAL',height:'MEDIUM'}:{}),actions:this.actions(card.suggestions,false)};}
  private async content(context:ProviderContext,request:SendRequest){
    const message=request.message;
    if(message.type==='text')return {'twilio/card':{body:message.text,actions:this.actions(message.suggestions,true)}};
    if(message.type==='rich_card'){const card=await this.card(context,message.card);if(!message.card.media && !message.card.suggestions?.length && !message.suggestions?.length)throw new VendorHttpError(400);return {'twilio/card':{...card,actions:[...card.actions,...this.actions(message.suggestions,true)]}};}
    if(message.type==='media'){if(message.suggestions?.length)throw new VendorHttpError(400);return {'twilio/media':{body:message.text??'',media:[await imageUrl(context,message.media)]}};}
    if(message.type==='carousel'){
      if(message.suggestions?.length || message.cards.length<2 || message.cards.length>10)throw new VendorHttpError(400);
      let layout:string|undefined;const cards=[];
      for(const card of message.cards){if(!card.media || !card.body || card.title.length+card.body.length>160 || !card.suggestions?.length || card.suggestions.length>2)throw new VendorHttpError(400);const current=card.suggestions.map(item=>item.type).join(',');if(layout && layout!==current)throw new VendorHttpError(400);layout=current;cards.push({title:card.title,body:card.body,media:await imageUrl(context,card.media),height:'MEDIUM',actions:this.actions(card.suggestions,undefined,true)});}
      return {'twilio/carousel':{body:' ',cards}};
    }
    throw new VendorHttpError(400);
  }
  getProviderMetadata() { return { id: 'twilio', name: 'Twilio RCS', environments: ['test'], credentialSchema: credentialSchema(keys, ['authToken']) }; }
  getSupportedEvents() { return ['message.sent', 'message.delivered', 'message.read', 'message.failed', 'message.received','action.selected'] as const; }
  validateCredentials(c: Credentials, environment: string) { if (!validKeys(c, environment, keys) || !/^AC[0-9a-fA-F]{32}$/.test(c.accountSid!) || !/^[a-zA-Z0-9_.@-]{1,128}$/.test(c.sender!)) return false; try { const url = new URL(c.webhookUrl!); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.pathname === '/webhooks/rcs/twilio' && [...url.searchParams.keys()].join(',') === 'connectionId' && /^[0-9a-f-]{36}$/i.test(url.searchParams.get('connectionId') ?? ''); } catch { return false; } }
  getExternalAgentId(c: Credentials, environment: string) { if (!this.validateCredentials(c, environment)) throw new Error('Invalid credentials'); return c.sender!; }
  async send(context: ProviderContext, request: SendRequest): Promise<SendResult> {
    try { const error = this.sendError(context, request); if (error) return { accepted: false, error }; if (new URL(context.credentials.webhookUrl!).searchParams.get('connectionId') !== context.connectionId) throw new VendorHttpError(400);
      const authorization=`Basic ${Buffer.from(`${context.credentials.accountSid}:${context.credentials.authToken}`).toString('base64')}`;
      const fields:Record<string,string>={From:`rcs:${request.agentId}`,To:`rcs:${request.recipient}`,StatusCallback:context.credentials.webhookUrl!};
      if(request.message.type==='text' && !request.message.suggestions?.length)fields.Body=request.message.text;
      else {const types=await this.content(context,request);const content=await vendorJson(this.fetcher,context,'https://content.twilio.com/v1/Content',{authorization,'content-type':'application/json'},JSON.stringify({friendly_name:`rcs-${createHash('sha256').update(request.idempotencyKey).digest('hex')}`,language:'pt',types}));if(!/^HX[0-9a-fA-F]{32}$/.test(String(content.sid)) || content.account_sid!==context.credentials.accountSid)throw new Error('Unconfirmed content');fields.ContentSid=String(content.sid);}
      const result = await vendorJson(this.fetcher, context, `https://api.twilio.com/2010-04-01/Accounts/${context.credentials.accountSid}/Messages.json`, { authorization, 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams(fields).toString());
      if (!/^SM[0-9a-fA-F]{32}$/.test(String(result.sid)) || result.account_sid !== context.credentials.accountSid || result.from !== `rcs:${request.agentId}` || result.to !== `rcs:${request.recipient}` || !['queued', 'accepted', 'sending', 'sent', 'delivered', 'read'].includes(String(result.status))) throw new Error('Unconfirmed');
      return { accepted: true, providerMessageId: String(result.sid) };
    } catch (error) { return { accepted: false, error: vendorError(error) }; }
  }
  private decode(context: ProviderContext, request: WebhookRequest): Record<string, string> | null {
    try { this.assertContext(context); if (request.rawBody.length > 65536 || !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded') || new URL(context.credentials.webhookUrl!).searchParams.get('connectionId') !== context.connectionId) return null;
      const params = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(request.rawBody)); const value: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const [key, item] of params) { if (Object.hasOwn(value, key) || !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || Object.keys(value).length >= 100) return null; value[key] = item; }
      if (!request.headers['x-twilio-signature'] || !twilio.validateRequest(context.credentials.authToken!, request.headers['x-twilio-signature'], context.credentials.webhookUrl!, value) || value.AccountSid !== context.credentials.accountSid || !this.normalizeEvent(context, value)) return null; return value;
    } catch { return null; }
  }
  async verifyWebhook(context: ProviderContext, request: WebhookRequest) { return this.decode(context, request) !== null; }
  async parseWebhook(context: ProviderContext, request: WebhookRequest) { const value = this.decode(context, request); return value ? [value] : []; }
  normalizeEvent(context: ProviderContext, input: unknown): CanonicalEvent | null {
    if (!input || typeof input !== 'object') return null; const value = input as Record<string, unknown>; const status = typeof value.MessageStatus === 'string' ? value.MessageStatus : value.SmsStatus; const type = typeof status === 'string' ? statuses[status] : undefined;
    if (!type || value.AccountSid !== context.credentials.accountSid || !/^SM[0-9a-fA-F]{32}$/.test(String(value.MessageSid))) return null;
    const incoming = type === 'message.received'; const agent = incoming ? value.To : value.From; const recipient = incoming ? value.From : value.To;
    if (agent !== `rcs:${context.credentials.sender}` || typeof recipient !== 'string' || !phone(recipient.slice(4)) || !recipient.startsWith('rcs:') || incoming && (typeof value.Body!=='string' || !value.Body.trim() || value.Body.length > 1000 || value.NumMedia && value.NumMedia !== '0')) return null;
    if(incoming && value.ButtonPayload!==undefined && (!nonempty(value.ButtonPayload) || value.ButtonPayload.length>4096))return null;
    const choice=incoming && typeof value.ButtonPayload==='string';
    return { id: `${value.MessageSid}:${status}`, type:choice?'action.selected':type, workspaceId: context.workspaceId, connectionId: context.connectionId, providerId: 'twilio', providerMessageId: String(value.MessageSid), recipient: recipient.slice(4), occurredAt: new Date(this.now()).toISOString(), ...(choice ? actionFields(String(value.ButtonPayload)) : incoming ? { message: { type: 'text' as const, text: String(value.Body) } } : {}) };
  }
}
