import type { Suggestion,RichCard,Media } from '@rcs/providers';
import { messageArchetypes,MessageInputError,type MessageContent,type MessageInput } from './contracts.js';
const uuid = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
function text(value: unknown,max: number) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new MessageInputError('invalid');
}
function keys(value: object,allowed: string[]) { if (Object.keys(value).some((key) => !allowed.includes(key))) throw new MessageInputError('invalid'); }
function suggestions(items: readonly Suggestion[] | undefined) {
  if (items === undefined) return 0;
  if (!Array.isArray(items) || items.length > 10) throw new MessageInputError('invalid');
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new MessageInputError('invalid');
    text(item.text,100);
    if (item.type === 'reply') { keys(item,['type','text','payload']); text(item.payload,256); }
    else if (item.type === 'open_url') {
      keys(item,['type','text','url']); text(item.url,2048);
      try { const url = new URL(item.url); if (url.protocol !== 'https:' || url.username || url.password || /[\x00-\x20\x7f]/.test(item.url)) throw new Error(); }
      catch { throw new MessageInputError('invalid'); }
    } else throw new MessageInputError('invalid');
  }
  return items.length;
}
function media(value: Media) {
  if (!value || typeof value !== 'object') throw new MessageInputError('invalid');
  keys(value,['assetId','mimeType']);
  if (!uuid.test(value.assetId) || !['image/png','image/jpeg','image/webp'].includes(value.mimeType)) throw new MessageInputError('invalid');
}
function card(value: RichCard) {
  if (!value || typeof value !== 'object') throw new MessageInputError('invalid');
  keys(value,['title','body','media','suggestions']); text(value.title,200); text(value.body,10000);
  if (value.media !== undefined) media(value.media);
  return suggestions(value.suggestions);
}
export function validateMessageInput(input: MessageInput): MessageInput {
  if (!input || typeof input !== 'object') throw new MessageInputError('invalid');
  keys(input,['name','purpose','content','archetype']); text(input.name,100);
  if (!['marketing','transactional','authentication'].includes(input.purpose)) throw new MessageInputError('invalid');
  if(input.archetype!==undefined && input.archetype!==null && !(messageArchetypes[input.purpose] as readonly string[]).includes(input.archetype))throw new MessageInputError('invalid');
  const content: MessageContent = input.content;
  if (!content || typeof content !== 'object') throw new MessageInputError('invalid');
  let count = suggestions(content.suggestions);
  if (content.type === 'text') { keys(content,['type','text','suggestions']); text(content.text,10000); }
  else if (content.type === 'rich_card') {
    keys(content,['type','card','suggestions']);
    count += card(content.card);
  } else if (content.type === 'carousel') {
    keys(content,['type','cards','suggestions']);
    if (!Array.isArray(content.cards) || content.cards.length<2 || content.cards.length>10) throw new MessageInputError('invalid');
    for (const value of content.cards) count += card(value);
  } else if (content.type === 'media' || content.type==='file') {
    keys(content,['type','media','suggestions']); media(content.media);
  } else throw new MessageInputError('invalid');
  if (count > 10 || Buffer.byteLength(JSON.stringify(content)) > 65536) throw new MessageInputError('invalid');
  return { name: input.name.trim(),purpose: input.purpose,...(input.archetype==null?{}:{archetype:input.archetype}),content: structuredClone(content) };
}
