import React from 'react';
import type { MessageContent } from './types';
export default function MessagePreview({ content,workspaceId }: { content: MessageContent; workspaceId: string }) {
  const card = content.type === 'rich_card' ? content.card : null;
  const suggestions = [...(card?.suggestions ?? []),...(content.suggestions ?? [])];
  return <div className="messagePreview" aria-label="Prévia da mensagem"><div className="messageBubble">
    {(content.type==='media' || content.type==='file') && <img src={`/api/workspaces/${workspaceId}/media/${content.media.assetId}/content`} alt="Imagem da mensagem" className="messageImage"/>}
    {content.type==='carousel' && <div aria-label="Carrossel">{content.cards.map((item,index)=><article key={index}>{item.media && <img src={`/api/workspaces/${workspaceId}/media/${item.media.assetId}/content`} alt={`Imagem do cartão ${index+1}`} className="messageImage"/>}<h3>{item.title}</h3><p>{item.body}</p>{item.suggestions?.map((suggestion,i)=><p key={i}>{suggestion.text}</p>)}</article>)}</div>}
    {card ? <>{card.media && <img src={`/api/workspaces/${workspaceId}/media/${card.media.assetId}/content`} alt="Imagem da mensagem" className="messageImage" loading="lazy" />}<h3>{card.title}</h3><p>{card.body}</p></> : <p>{content.type === 'text' ? content.text : ''}</p>}
    {suggestions.length > 0 && <ul className="messageSuggestions" aria-label="Sugestões da mensagem">{suggestions.map((item,index) => <li key={index}><strong>{item.text}</strong><small>{item.type === 'reply' ? 'Resposta sugerida' : item.url}</small></li>)}</ul>}
  </div></div>;
}
