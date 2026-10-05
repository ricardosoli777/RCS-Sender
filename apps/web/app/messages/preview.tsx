'use client';
import React,{useState} from 'react';
import type { MessageContent,Suggestion } from './types';
function safeUrl(value: string) {
  try { const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password?url.href:null; }catch{return null;}
}
function Actions({ items,onReply }: { items: Suggestion[]; onReply(text: string): void }) {
  if(!items.length)return null;
  return <ul className="messageSuggestions" aria-label="Sugestões da mensagem">{items.map((item,index)=>{
    const url=item.type==='open_url'?safeUrl(item.url):null;
    return <li key={index}>{item.type==='open_url' ? url ? <a className="button buttonSecondary" href={url} target="_blank" rel="noopener noreferrer">{item.text}</a> : <button type="button" disabled title="Informe uma URL HTTPS válida">{item.text}</button> : <button type="button" className="buttonSecondary" onClick={()=>onReply(item.text)}>{item.text}</button>}<small>{item.type==='reply'?'Resposta sugerida':url??'Informe uma URL HTTPS válida'}</small></li>;
  })}</ul>;
}
export default function MessagePreview({ content,workspaceId }: { content: MessageContent; workspaceId: string }) {
  const [reply,setReply]=useState<string|null>(null);const card=content.type==='rich_card'?content.card:null;
  return <div className="messagePreview" aria-label="Prévia da mensagem"><div className="messageBubble">
    {(content.type==='media' || content.type==='file') && <img src={`/api/workspaces/${workspaceId}/media/${content.media.assetId}/content`} alt="Imagem da mensagem" className="messageImage"/>}
    {content.type==='carousel' && <div aria-label="Carrossel">{content.cards.map((item,index)=><article key={index}>{item.media && <img src={`/api/workspaces/${workspaceId}/media/${item.media.assetId}/content`} alt={`Imagem do cartão ${index+1}`} className="messageImage"/>}<h3>{item.title}</h3><p>{item.body}</p><Actions items={item.suggestions??[]} onReply={setReply}/></article>)}</div>}
    {card ? <>{card.media && <img src={`/api/workspaces/${workspaceId}/media/${card.media.assetId}/content`} alt="Imagem da mensagem" className="messageImage" loading="lazy"/>}<h3>{card.title}</h3><p>{card.body}</p><Actions items={card.suggestions??[]} onReply={setReply}/></> : content.type==='text'?<p>{content.text}</p>:null}
    <Actions items={content.suggestions??[]} onReply={setReply}/>
    {reply!==null && <p role="status">Prévia: você escolheu “{reply}”. Nenhuma resposta foi enviada.</p>}
  </div></div>;
}
