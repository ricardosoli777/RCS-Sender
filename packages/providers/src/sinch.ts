import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {capabilityMatrix} from './capabilities.js';
import {actionFields} from './action-correlation.js';
import type { CanonicalEvent, Credentials, ProviderContext, SendRequest, SendResult, WebhookRequest,RichCard,Suggestion } from './contracts.js';
import { VendorHttpError,VendorTextProvider, credentialSchema, validKeys, vendorJson, vendorError, object, nonempty, phone, date, jsonBody } from './vendor-http.js';
const keys = ['projectId', 'appId', 'keyId', 'keySecret', 'region', 'webhookSecret'] as const;
export class SinchProvider extends VendorTextProvider {
  getProviderCapabilities(){return capabilityMatrix({...super.getProviderCapabilities(),rich_card:'supported',carousel:'supported',media:'supported',suggested_replies:'supported',url_actions:'supported',eligibility:'supported'});}
  getProviderLimits(){return {maxTextCharacters:3072,maxTitleCharacters:200,maxSuggestions:11,maxCards:10};}
  async checkEligibility():Promise<boolean|null>{return null;}
  async requestEligibility(context:ProviderContext,recipient:string,requestId:string){
    try{this.assertContext(context);if(!phone(recipient) || !/^[a-f0-9-]{36}$/i.test(requestId))return false;
      const result=await vendorJson(this.fetcher,context,`https://${context.credentials.region}.conversation.api.sinch.com/v1/projects/${context.credentials.projectId}/capability:query`,{authorization:`Basic ${Buffer.from(`${context.credentials.keyId}:${context.credentials.keySecret}`).toString('base64')}`,'content-type':'application/json'},JSON.stringify({app_id:context.credentials.appId,request_id:requestId,recipient:{identified_by:{channel_identities:[{channel:'RCS',identity:recipient.slice(1)}]}}}));
      return result.request_id===requestId && result.app_id===context.credentials.appId;
    }catch{return false;}
  }
  normalizeEligibility(context:ProviderContext,input:unknown){
    const value=object(input);const item=object(value?.capability_notification);
    if(value?.project_id!==context.credentials.projectId || value?.app_id!==context.credentials.appId || item?.channel!=='RCS' || typeof item.identity!=='string' || typeof item.request_id!=='string' || !/^[a-f0-9-]{36}$/i.test(item.request_id))return null;
    const recipient=item.identity.startsWith('+') ? item.identity : `+${item.identity}`;
    if(!phone(recipient) || !['CAPABILITY_FULL','CAPABILITY_PARTIAL','CAPABILITY_UNKNOWN','NO_CAPABILITY'].includes(String(item.capability_status)))return null;
    return {requestId:item.request_id,recipient,eligible:item.capability_status==='CAPABILITY_FULL' ? true : item.capability_status==='NO_CAPABILITY' ? false : null};
  }
  getProviderMetadata() { return { id: 'sinch', name: 'Sinch Conversation RCS', environments: ['test'], credentialSchema: credentialSchema(keys, ['keySecret', 'webhookSecret']) }; }
  getSupportedEvents() { return ['message.sent', 'message.delivered', 'message.read', 'message.failed', 'message.received','action.selected'] as const; }
  validateCredentials(c: Credentials, environment: string) { return validKeys(c, environment, keys) && [c.projectId!, c.appId!, c.keyId!].every((id) => /^[a-zA-Z0-9_-]{1,128}$/.test(id)) && ['us', 'eu'].includes(c.region!) && c.webhookSecret!.length >= 32; }
  getExternalAgentId(c: Credentials, environment: string) { if (!this.validateCredentials(c, environment)) throw new Error('Invalid credentials'); return `${c.projectId}:${c.appId}`; }
  private async content(context:ProviderContext,request:SendRequest){
    const choices=(items?:readonly Suggestion[])=>items?.map(item=>{
      if(item.text.length>25)throw new VendorHttpError(400);
      return item.type==='reply' ? {text_message:{text:item.text},postback_data:item.payload} : {url_message:{title:item.text,url:item.url},postback_data:item.url};
    });
    const media=async(value:{assetId:string;mimeType:string})=>{
      if(!context.resolveMedia || !['image/png','image/jpeg'].includes(value.mimeType))throw new VendorHttpError(400);
      const asset=await context.resolveMedia(value);const url=new URL(asset.url);
      if(url.protocol!=='https:' || url.username || url.password || asset.mimeType!==value.mimeType || asset.byteSize>2097152)throw new VendorHttpError(400);
      return {url:url.href};
    };
    const card=async(value:RichCard)=>{
      if(value.title.length>200 || value.body.length>2000 || (value.suggestions?.length ?? 0)>4)throw new VendorHttpError(400);
      return {title:value.title,description:value.body,...(value.media ? {media_message:await media(value.media)} : {}),...(value.suggestions?.length ? {choices:choices(value.suggestions)} : {})};
    };
    const message=request.message;
    if(message.type==='text')return message.suggestions?.length ? {choice_message:{text_message:{text:message.text},choices:choices(message.suggestions)}} : {text_message:{text:message.text}};
    if(message.type==='rich_card') {if(message.suggestions?.length)throw new Error('Unsupported placement');return {card_message:await card(message.card)};}
    if(message.type==='carousel'){if(message.cards.length<2)throw new VendorHttpError(400);const cards=[];for(const item of message.cards)cards.push(await card(item));return {carousel_message:{cards,...(message.suggestions?.length ? {choices:choices(message.suggestions)} : {})}};}
    if(message.type==='media' && !message.text && !message.suggestions?.length)return {media_message:await media(message.media)};
    throw new VendorHttpError(400);
  }
  async send(context: ProviderContext, request: SendRequest): Promise<SendResult> {
    try { const error = this.sendError(context, request); if (error) return { accepted: false, error };
      const result = await vendorJson(this.fetcher, context, `https://${context.credentials.region}.conversation.api.sinch.com/v1/projects/${context.credentials.projectId}/messages:send`, { authorization: `Basic ${Buffer.from(`${context.credentials.keyId}:${context.credentials.keySecret}`).toString('base64')}`, 'content-type': 'application/json' }, JSON.stringify({ app_id: context.credentials.appId, recipient: { identified_by: { channel_identities: [{ channel: 'RCS', identity: request.recipient.slice(1) }] } }, message: await this.content(context,request), channel_priority_order: ['RCS'], processing_mode: 'DISPATCH' }));
      if (!nonempty(result.message_id)) throw new Error('Unconfirmed'); return { accepted: true, providerMessageId: result.message_id };
    } catch (error) { return { accepted: false, error: vendorError(error) }; }
  }
  private signed(context: ProviderContext, request: WebhookRequest, fresh: boolean) {
    try { this.assertContext(context); const h = request.headers; const timestamp = h['x-sinch-webhook-signature-timestamp']; const nonce = h['x-sinch-webhook-signature-nonce']; const signature = h['x-sinch-webhook-signature'];
      if (request.rawBody.length > 65536 || h['x-sinch-webhook-signature-algorithm'] !== 'HmacSHA256' || !timestamp || !/^\d{10}$/.test(timestamp) || !nonce || !/^[a-zA-Z0-9_-]{1,128}$/.test(nonce) || !signature || !/^[a-zA-Z0-9+/]{43}=$/.test(signature) || fresh && Math.abs(this.now() - Number(timestamp) * 1000) > 300000) return false;
      const expected = createHmac('sha256', context.credentials.webhookSecret!).update(request.rawBody).update(`.${nonce}.${timestamp}`).digest(); return timingSafeEqual(expected, Buffer.from(signature, 'base64'));
    } catch { return false; }
  }
  async verifyWebhook(context: ProviderContext, request: WebhookRequest) { if (!this.signed(context, request, true)) return false; const value = jsonBody(request); return value?.project_id === context.credentials.projectId && value?.app_id === context.credentials.appId; }
  async parseWebhook(context: ProviderContext, request: WebhookRequest) { if (!this.signed(context, request, false)) return []; const value = jsonBody(request); return value?.project_id === context.credentials.projectId && value?.app_id === context.credentials.appId ? [value] : []; }
  normalizeEvent(context: ProviderContext, input: unknown): CanonicalEvent | null {
    const value = object(input); if (!value || value.project_id !== context.credentials.projectId || value.app_id !== context.credentials.appId) return null;
    const occurredAt = date(value.event_time) ?? date(value.accepted_time); if (!occurredAt) return null;
    const report = object(value.message_delivery_report); const incoming = object(value.message); const submitted = object(value.message_submit_notification); const item = report ?? incoming ?? submitted; const identity = object(item?.channel_identity);
    if (!item || identity?.channel !== 'RCS' || typeof identity.identity !== 'string') return null; const recipient = identity.identity.startsWith('+') ? identity.identity : `+${identity.identity}`; if (!phone(recipient)) return null;
    const choice=object(object(incoming?.contact_message)?.choice_response_message);
    const messageId = choice?.message_id ?? report?.message_id ?? incoming?.id ?? submitted?.message_id; if (!nonempty(messageId)) return null;
    const map: Readonly<Record<string, CanonicalEvent['type']>> = { DELIVERED: 'message.delivered', READ: 'message.read', FAILED: 'message.failed' };
    const type = report && typeof report.status === 'string' ? map[report.status] : incoming?.direction === 'TO_APP' ? choice ? 'action.selected' : 'message.received' : submitted ? 'message.sent' : undefined;
    const text = object(object(incoming?.contact_message)?.text_message)?.text;
    if (!type || type === 'message.received' && (typeof text !== 'string' || !text.trim() || text.length > 3072) || type==='action.selected' && !nonempty(choice?.postback_data)) return null;
    return { id: createHash('sha256').update(JSON.stringify([incoming?.id ?? messageId, type])).digest('hex'), type, workspaceId: context.workspaceId, connectionId: context.connectionId, providerId: 'sinch', providerMessageId: messageId, recipient, occurredAt, ...(type === 'message.received' ? { message: { type: 'text' as const, text: String(text) } } : {}),...(type==='action.selected' ? actionFields(String(choice!.postback_data)) : {}) };
  }
}
