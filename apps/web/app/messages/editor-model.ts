import type { MessageContent,MessagePurpose,MessageVersion,MessageCard } from './types';
export type Asset = { id: string; name: string; mime_type: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number };
export type EditorSuggestion = { type: 'reply' | 'open_url'; destination?:'journey_branch'; text: string; value: string; placement: 'message' | 'card' };
export type Draft = { name: string; purpose: MessagePurpose; archetype?: string; format: 'text' | 'rich_card' | 'carousel' | 'media' | 'file'; title: string; body: string; media?: { assetId: string; mimeType: string }; suggestions: EditorSuggestion[];cards?:MessageCard[] };
export type ProviderOption = { id: string; name: string; active: boolean; capabilities: Record<string,'supported' | 'unsupported' | 'unknown'>; limits: { maxTextCharacters?: number; maxTitleCharacters?: number; maxSuggestions?: number;maxCards?:number } };
export function toDraft(version?: MessageVersion): Draft {
  const content = version?.content; const card = content?.type === 'rich_card' ? content.card : undefined;
  const map = (items: MessageContent['suggestions'],placement: EditorSuggestion['placement']) => (items ?? []).map((item) => ({ type: item.type,text: item.text,value: item.type === 'reply' ? item.payload : item.url,placement }));
  return { name: version?.name ?? '',purpose: version?.purpose ?? 'marketing',archetype:version?.archetype??undefined,format: content?.type ?? 'text',title: card?.title ?? '',body: card?.body ?? (content?.type === 'text' ? content.text : ''),media: (content?.type==='media' || content?.type==='file') ? {...content.media} : card?.media ? { ...card.media } : undefined,cards:content?.type==='carousel' ? structuredClone(content.cards) : undefined,suggestions: [...map(content?.suggestions,'message'),...map(card?.suggestions,'card')] };
}
export function contentOf(draft: Draft): MessageContent {
  const map = (items: EditorSuggestion[]) => items.map((item) => item.type === 'reply' ? { type: 'reply' as const,text: item.text,payload: item.value } : { type: 'open_url' as const,text: item.text,url: item.value });
  if(draft.format==='carousel') return {type:'carousel',cards:structuredClone(draft.cards ?? [{title:'',body:''},{title:'',body:''}]),suggestions:map(draft.suggestions)};
  if(draft.format==='media' || draft.format==='file') return {type:draft.format,media:draft.media ? {...draft.media} : {assetId:'',mimeType:'image/png'},suggestions:map(draft.suggestions)};
  if (draft.format === 'text') return { type: 'text',text: draft.body,...(draft.suggestions.length ? { suggestions: map(draft.suggestions) } : {}) };
  const root = map(draft.suggestions.filter((item) => item.placement === 'message')); const card = map(draft.suggestions.filter((item) => item.placement === 'card'));
  return { type: 'rich_card',card: { title: draft.title,body: draft.body,...(draft.media ? { media: { ...draft.media } } : {}),...(card.length ? { suggestions: card } : {}) },...(root.length ? { suggestions: root } : {}) };
}
export function draftIssues(draft: Draft,expectedVersion?: number): string[] {
  const issues: string[] = [];
  const text = (value: string,max: number,label: string) => { if (!value.trim() || Array.from(value).length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) issues.push(`${label}: preencha até ${max.toLocaleString('pt-BR')} caracteres válidos.`); };
  text(draft.name,100,'Nome'); if (draft.format === 'text' || draft.format === 'rich_card') text(draft.body,10000,'Texto'); if (draft.format === 'rich_card') text(draft.title,200,'Título');
  if((draft.format==='media' || draft.format==='file') && !draft.media) issues.push('Escolha uma imagem.');
  if(draft.format==='carousel') {
    const cards=draft.cards ?? [];
    if(cards.length<2 || cards.length>10) issues.push('Use entre dois e dez cartões.');
    cards.forEach((card,index)=>{text(card.title,200,`Título do cartão ${index+1}`);text(card.body,10000,`Texto do cartão ${index+1}`);});
  }
  if (draft.suggestions.length > 10) issues.push('Use até dez sugestões no total.');
  draft.suggestions.forEach((item,index) => {
    text(item.text,100,`Sugestão ${index+1}`); text(item.value,item.type === 'reply' ? 256 : 2048,item.type === 'reply' ? `Valor da resposta ${index+1}` : `URL ${index+1}`);
    if (item.type === 'open_url') { try { const url = new URL(item.value); if (url.protocol !== 'https:' || url.username || url.password || /[\x00-\x20\x7f]/.test(item.value)) throw new Error(); } catch { issues.push(`URL ${index+1}: use HTTPS, sem credenciais ou espaços.`); } }
  });
  const payload = { name: draft.name,purpose: draft.purpose,content: contentOf(draft),...(expectedVersion === undefined ? {} : { expectedVersion }) };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 65536) issues.push('A mensagem completa deve ocupar até 64 KiB.');
  return issues;
}
export function providerIssues(draft: Draft,provider: ProviderOption): string[] {
  const issues: string[] = []; if (!provider.active) issues.push('Adaptador inativo.');
  const requirements = new Map<string,string>([[draft.format,{text:'Texto',rich_card:'Rich card',carousel:'Carrossel',media:'Imagem',file:'Arquivo'}[draft.format]]]);
  if ((draft.format === 'rich_card' && draft.media) || draft.format==='carousel' && draft.cards?.some(card=>card.media)) requirements.set('media','Mídia');
  if(draft.format==='carousel'){
    if(provider.limits.maxCards!==undefined && (draft.cards?.length??0)>provider.limits.maxCards)issues.push(`Cartões excedem o limite ${provider.limits.maxCards} do adaptador.`);
    for(const card of draft.cards??[]){
      if(provider.limits.maxTextCharacters!==undefined && Array.from(card.body).length>provider.limits.maxTextCharacters)issues.push('Texto de cartão excede o limite do adaptador.');
      if(provider.limits.maxTitleCharacters!==undefined && Array.from(card.title).length>provider.limits.maxTitleCharacters)issues.push('Título de cartão excede o limite do adaptador.');
      for(const item of card.suggestions??[])requirements.set(item.type==='reply'?'suggested_replies':'url_actions',item.type==='reply'?'Respostas sugeridas':'Ações de URL');
    }
  }
  for (const item of draft.suggestions) requirements.set(item.type === 'reply' ? 'suggested_replies' : 'url_actions',item.type === 'reply' ? 'Respostas sugeridas' : 'Ações de URL');
  for (const [key,label] of requirements) { const state = provider.capabilities[key] ?? 'unknown'; if (state !== 'supported') issues.push(`${label}: ${state === 'unsupported' ? 'não suportado' : 'suporte desconhecido'}.`); }
  if (provider.limits.maxTextCharacters !== undefined && Array.from(draft.body).length > provider.limits.maxTextCharacters) issues.push(`Texto excede ${provider.limits.maxTextCharacters} caracteres do adaptador.`);
  if (draft.format === 'rich_card' && provider.limits.maxTitleCharacters !== undefined && Array.from(draft.title).length > provider.limits.maxTitleCharacters) issues.push(`Título excede ${provider.limits.maxTitleCharacters} caracteres do adaptador.`);
  if (provider.limits.maxSuggestions !== undefined && draft.suggestions.length > provider.limits.maxSuggestions) issues.push(`Sugestões excedem o limite ${provider.limits.maxSuggestions} do adaptador.`);
  return issues;
}
