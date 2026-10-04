import type {CanonicalEvent,CanonicalMessage,Suggestion} from './contracts.js';
/** A host dispatch identity carried unchanged through documented vendor postbacks. */
export function actionData(key:string,value:string){return JSON.stringify({rcsAction:1,key,value});}
export function actionFields(raw:string):Pick<CanonicalEvent,'actionPayload'|'dispatchKey'>{
  try{const value=JSON.parse(raw);if(value?.rcsAction===1 && typeof value.key==='string' && /^dispatch-[a-f0-9-]{36}$/.test(value.key) && typeof value.value==='string' && value.value.trim() && Buffer.byteLength(value.value)<=4096)return {actionPayload:value.value,dispatchKey:value.key};}catch{/* External payloads have no host correlation. */}
  return {actionPayload:raw};
}
export function correlateActions(message:CanonicalMessage,key:string):CanonicalMessage{
  const map=(items:readonly Suggestion[]|undefined)=>items?.map(item=>item.type==='reply'?{...item,payload:actionData(key,item.payload)}:item);
  return {...message,...(message.suggestions?{suggestions:map(message.suggestions)}:{}),...(message.type==='rich_card'?{card:{...message.card,...(message.card.suggestions?{suggestions:map(message.card.suggestions)}:{})}}:{}),...(message.type==='carousel'?{cards:message.cards.map(card=>({...card,...(card.suggestions?{suggestions:map(card.suggestions)}:{})}))}:{})} as CanonicalMessage;
}
