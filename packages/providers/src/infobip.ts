import {createHash,timingSafeEqual} from 'node:crypto';
import {capabilityMatrix} from './capabilities.js';
import type { Credentials, ProviderContext, SendRequest, SendResult,CanonicalEvent,WebhookRequest,RichCard,Suggestion } from './contracts.js';
import { VendorHttpError,VendorTextProvider, credentialSchema, validKeys, vendorJson, vendorError, object, nonempty,phone,date,jsonBody } from './vendor-http.js';
const keys = ['apiKey', 'baseHost', 'sender','webhookUsername','webhookPassword'] as const;
/** Documented synchronous text sending; async eligibility and callbacks remain unverified. */
export class InfobipProvider extends VendorTextProvider {
  getProviderMetadata() { return { id: 'infobip', name: 'Infobip RCS', environments: ['test'], credentialSchema: credentialSchema(keys, ['apiKey','webhookPassword']) }; }
  getProviderCapabilities(){return capabilityMatrix({text:'supported',rich_card:'supported',carousel:'supported',media:'supported',suggested_replies:'supported',url_actions:'supported',eligibility:'supported',file:'unsupported'});}
  getProviderLimits(){return {maxTextCharacters:3072,maxTitleCharacters:200,maxSuggestions:11,maxCards:10};}
  getSupportedEvents(){return ['message.delivered','message.read','message.failed','message.received','action.selected'] as const;}
  validateCredentials(c: Credentials, environment: string) { return validKeys(c, environment, keys) && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?api\.infobip\.com$/.test(c.baseHost!) && /^[a-zA-Z0-9_.@-]{1,128}$/.test(c.sender!) && /^[A-Za-z0-9_-]{1,128}$/.test(c.webhookUsername!) && c.webhookPassword!.length>=32; }
  getExternalAgentId(c: Credentials, environment: string) { if (!this.validateCredentials(c, environment)) throw new Error('Invalid credentials'); return c.sender!; }
  async checkEligibility(context:ProviderContext,recipient:string):Promise<boolean|null>{
    try {this.assertContext(context);if(!phone(recipient))return null;
      const result=await vendorJson(this.fetcher,context,`https://${context.credentials.baseHost}/rcs/2/capability-check/query`,{authorization:`App ${context.credentials.apiKey}`,'content-type':'application/json'},JSON.stringify({sender:context.credentials.sender,phoneNumbers:[recipient.slice(1)]}));
      const item=Array.isArray(result.capabilityCheckResults) && result.capabilityCheckResults.length===1 ? object(result.capabilityCheckResults[0]) : null;
      if(item?.phoneNumber!==recipient.slice(1))return null;
      return item.code==='ENABLED' ? true : item.code==='UNREACHABLE' ? false : null;
    }catch{return null;}
  }
  private async content(context:ProviderContext,request:SendRequest){
    const suggestions=(items?:readonly Suggestion[])=>items?.map(item=>{
      if(Array.from(item.text).length>25)throw new VendorHttpError(400);
      return item.type==='reply' ? {type:'REPLY',text:item.text,postbackData:item.payload} : {type:'OPEN_URL',text:item.text,url:item.url,postbackData:item.url};
    });
    const file=async(media:{assetId:string;mimeType:string})=>{
      if(!context.resolveMedia || !['image/png','image/jpeg'].includes(media.mimeType))throw new VendorHttpError(400);
      const published=await context.resolveMedia(media);const url=new URL(published.url);
      if(url.protocol!=='https:' || url.username || url.password || published.mimeType!==media.mimeType || published.byteSize>2097152)throw new VendorHttpError(400);
      return {url:url.href};
    };
    const card=async(value:RichCard)=>{
      if(Array.from(value.body).length>2000 || (value.suggestions?.length ?? 0)>4)throw new VendorHttpError(400);
      return {title:value.title,description:value.body,...(value.media ? {media:{file:await file(value.media),height:'MEDIUM'}} : {}),...(value.suggestions?.length ? {suggestions:suggestions(value.suggestions)} : {})};
    };
    const message=request.message;const chips=message.suggestions?.length ? {suggestions:suggestions(message.suggestions)} : {};
    if(message.type==='text')return {type:'TEXT',text:message.text,...chips};
    if(message.type==='rich_card')return {type:'CARD',orientation:'VERTICAL',alignment:'LEFT',content:await card(message.card),...chips};
    if(message.type==='carousel') {if(message.cards.length<2)throw new VendorHttpError(400);const cards=[];for(const item of message.cards)cards.push(await card(item));return {type:'CAROUSEL',cardWidth:'MEDIUM',contents:cards,...chips};}
    if(message.type==='media' && !message.text)return {type:'FILE',file:await file(message.media),...chips};
    throw new VendorHttpError(400);
  }
  async send(context: ProviderContext, request: SendRequest): Promise<SendResult> {
    try { const error = this.sendError(context, request); if (error) return { accepted: false, error };
      const result = await vendorJson(this.fetcher, context, `https://${context.credentials.baseHost}/rcs/2/messages`, { authorization: `App ${context.credentials.apiKey}`, 'content-type': 'application/json' }, JSON.stringify({ messages: [{ sender: request.agentId, destinations: [{ to: request.recipient.slice(1) }], content: await this.content(context,request) }] }));
      const message = Array.isArray(result.messages) && result.messages.length === 1 ? object(result.messages[0]) : null;
      const status = object(message?.status); if (status?.groupName !== 'PENDING' || !nonempty(message?.messageId) || message?.destination !== request.recipient.slice(1)) throw new Error('Unconfirmed');
      return { accepted: true, providerMessageId: message.messageId };
    } catch (error) { return { accepted: false, error: vendorError(error) }; }
  }
  private decode(context:ProviderContext,request:WebhookRequest){
    try{this.assertContext(context);const supplied=request.headers.authorization;
      const expected=`Basic ${Buffer.from(`${context.credentials.webhookUsername}:${context.credentials.webhookPassword}`).toString('base64')}`;
      if(!supplied || !timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(expected).digest()))return null;
      const body=jsonBody(request);if(!Array.isArray(body?.results) || !body.results.length || body.results.length>100 || body.results.some(item=>!this.normalizeEvent(context,item)))return null;
      return body.results;
    }catch{return null;}
  }
  async verifyWebhook(context:ProviderContext,request:WebhookRequest){return this.decode(context,request)!==null;}
  async parseWebhook(context:ProviderContext,request:WebhookRequest){return this.decode(context,request) ?? [];}
  normalizeEvent(context:ProviderContext,input:unknown):CanonicalEvent|null{
    const value=object(input);if(!value || !nonempty(value.messageId) || (value.channel!==undefined && value.channel!=='RCS'))return null;
    const status=object(value.status);const content=object(value.message);
    const type=content?.type==='TEXT' ? 'message.received' : content?.type==='SUGGESTION' ? 'action.selected' : value.seenAt ? 'message.read' : status?.groupName==='DELIVERED' ? 'message.delivered' : ['UNDELIVERABLE','REJECTED','EXPIRED'].includes(String(status?.groupName)) ? 'message.failed' : null;
    const inbound=type==='message.received' || type==='action.selected' || type==='message.read';
    const agent=inbound ? value.to : value.sender;const raw=inbound ? (value.sender ?? value.from) : value.to;
    const recipient=typeof raw==='string' ? raw.startsWith('+') ? raw : `+${raw}` : '';
    const occurredAt=date(value.seenAt) ?? date(value.receivedAt) ?? date(value.doneAt);
    if(!type || agent!==context.credentials.sender || !phone(recipient) || !occurredAt || (content && value.integrationType!=='RCS'))return null;
    if(type==='message.received' && (typeof content?.text!=='string' || !content.text.trim() || Array.from(content.text).length>3072))return null;
    if(type==='action.selected' && !nonempty(content?.postbackData))return null;
    return {id:createHash('sha256').update(JSON.stringify([value.messageId,type])).digest('hex'),type,workspaceId:context.workspaceId,connectionId:context.connectionId,providerId:'infobip',providerMessageId:type==='action.selected' && nonempty(value.pairedMessageId)?value.pairedMessageId:value.messageId,recipient,occurredAt,...(type==='message.received' ? {message:{type:'text' as const,text:String(content!.text)}} : {}),...(type==='action.selected' ? actionFields(String(content!.postbackData)) : {})};
  }
}
import {actionFields} from './action-correlation.js';
