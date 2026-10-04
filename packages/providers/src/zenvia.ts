import { timingSafeEqual } from 'node:crypto';
import type { CanonicalEvent, Credentials, ProviderContext, RichCard, Suggestion, SendRequest, SendResult, WebhookRequest } from './contracts.js';
import {capabilityMatrix} from './capabilities.js';
import {imageUrl} from './rich-media.js';
import {actionFields} from './action-correlation.js';
import { VendorHttpError, VendorTextProvider, credentialSchema, validKeys, vendorJson, vendorError, object, nonempty, phone, date, jsonBody } from './vendor-http.js';
const keys = ['apiToken', 'sender', 'subscriptionId', 'webhookToken'] as const;
/** Subscription custom header is bearer authentication, not a body HMAC. */
export class ZenviaProvider extends VendorTextProvider {
  getProviderCapabilities(){return capabilityMatrix({text:'supported',rich_card:'supported',carousel:'supported',media:'supported',file:'unsupported',suggested_replies:'supported',url_actions:'supported'});}
  getProviderLimits(){return {maxTextCharacters:1000,maxTitleCharacters:200,maxCards:10,maxSuggestions:11};}
  private buttons(items:readonly Suggestion[]=[]){return items.map(item=>{if(item.text.length>25)throw new VendorHttpError(400);return item.type==='reply' ? {type:'text',text:item.text,payload:item.payload} : {type:'link',text:item.text,url:item.url,payload:item.url};});}
  private async card(context:ProviderContext,card:RichCard){if(card.title.length>200 || card.body.length>2000 || (card.suggestions?.length??0)>4)throw new VendorHttpError(400);return {title:card.title,text:card.body,...(card.media?{media:{url:await imageUrl(context,card.media),disposition:'ON_THE_TOP_MEDIUM_HEIGHT'}}:{}),...(card.suggestions?.length?{buttons:this.buttons(card.suggestions)}:{})};}
  private async content(context:ProviderContext,request:SendRequest){
    const message=request.message;const quickReplyButtons=this.buttons(message.suggestions);
    switch(message.type){
      case 'text':return quickReplyButtons.length ? {type:'replyable_text',text:message.text,quickReplyButtons} : {type:'text',text:message.text};
      case 'rich_card':return {type:'card',...await this.card(context,message.card),...(quickReplyButtons.length?{quickReplyButtons}:{})};
      case 'carousel':if(message.cards.length<2 || message.cards.length>10)throw new VendorHttpError(400);return {type:'carousel',cardWidth:'MEDIUM',cards:await Promise.all(message.cards.map(card=>this.card(context,card))),...(quickReplyButtons.length?{quickReplyButtons}:{})};
      case 'media':if(quickReplyButtons.length)throw new VendorHttpError(400);return {type:'file',fileUrl:await imageUrl(context,message.media),fileMimeType:message.media.mimeType,...(message.text?{fileCaption:message.text}:{})};
      default:throw new VendorHttpError(400);
    }
  }
  getProviderMetadata() { return { id: 'zenvia', name: 'Zenvia RCS', environments: ['test'], credentialSchema: credentialSchema(keys, ['apiToken', 'webhookToken']) }; }
  getSupportedEvents() { return ['message.sent', 'message.delivered', 'message.read', 'message.failed', 'message.received','action.selected'] as const; }
  validateCredentials(c: Credentials, environment: string) { return validKeys(c, environment, keys) && /^[a-zA-Z0-9_.@-]{1,64}$/.test(c.sender!) && /^[a-zA-Z0-9_-]{1,128}$/.test(c.subscriptionId!) && c.webhookToken!.length >= 32; }
  getExternalAgentId(c: Credentials, environment: string) { if (!this.validateCredentials(c, environment)) throw new Error('Invalid credentials'); return c.sender!; }
  async send(context: ProviderContext, request: SendRequest): Promise<SendResult> {
    try { const error = this.sendError(context, request); if (error) return { accepted: false, error };
      const result = await vendorJson(this.fetcher, context, 'https://api.zenvia.com/v2/channels/rcs/messages', { 'x-api-token': context.credentials.apiToken!, 'content-type': 'application/json' }, JSON.stringify({ from: request.agentId, to: request.recipient.slice(1), contents: [await this.content(context,request)] }));
      if (!nonempty(result.id) || result.from !== request.agentId || result.to !== request.recipient.slice(1) || result.channel !== 'rcs') throw new Error('Unconfirmed'); return { accepted: true, providerMessageId: result.id };
    } catch (error) { return { accepted: false, error: vendorError(error) }; }
  }
  private decode(context: ProviderContext, request: WebhookRequest) {
    try { this.assertContext(context); const supplied = request.headers['x-rcs-webhook-token']; if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(context.credentials.webhookToken!) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(context.credentials.webhookToken!))) return null;
      const value = jsonBody(request); return value && value.subscriptionId === context.credentials.subscriptionId && value.channel === 'rcs' && this.normalizeEvent(context, value) ? value : null;
    } catch { return null; }
  }
  async verifyWebhook(context: ProviderContext, request: WebhookRequest) { return this.decode(context, request) !== null; }
  async parseWebhook(context: ProviderContext, request: WebhookRequest) { const value = this.decode(context, request); return value ? [value] : []; }
  normalizeEvent(context: ProviderContext, input: unknown): CanonicalEvent | null {
    const value = object(input); const message = object(value?.message); const status = object(value?.messageStatus); if (!value || !message || value.channel !== 'rcs' || value.subscriptionId !== context.credentials.subscriptionId || !nonempty(value.id) || !nonempty(message.id)) return null;
    const inbound = value.type === 'MESSAGE' && value.direction === 'IN'; const map: Readonly<Record<string, CanonicalEvent['type']>> = { SENT: 'message.sent', DELIVERED: 'message.delivered', READ: 'message.read', REJECTED: 'message.failed', NOT_DELIVERED: 'message.failed' }; const type = inbound ? 'message.received' : value.type === 'MESSAGE_STATUS' && message.direction === 'OUT' && typeof status?.code === 'string' ? map[status.code] : undefined;
    const agent = inbound ? message.to : message.from; const rawPhone = inbound ? message.from : message.to; const recipient = typeof rawPhone === 'string' ? rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}` : null; const occurredAt = date(status?.timestamp) ?? date(message.timestamp) ?? date(value.timestamp);
    const content = Array.isArray(message.contents) && message.contents.length === 1 ? object(message.contents[0]) : null;
    if (!type || agent !== context.credentials.sender || !phone(recipient) || !occurredAt || inbound && (content?.type !== 'text' || typeof content.text !== 'string' || !content.text.trim() || content.text.length > 1000)) return null;
    if(inbound && content?.payload!==undefined && !nonempty(content.payload))return null;
    const choice=inbound && typeof content?.payload==='string';
    return { id: value.id, type:choice?'action.selected':type, workspaceId: context.workspaceId, connectionId: context.connectionId, providerId: 'zenvia', providerMessageId: message.id, recipient, occurredAt, ...(choice ? actionFields(String(content!.payload)) : inbound ? { message: { type: 'text' as const, text: String(content!.text) } } : {}) };
  }
}
