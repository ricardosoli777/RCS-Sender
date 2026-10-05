'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button,Card } from '../ui';
import MessagePreview from './preview';
import JourneyBranchPicker from './journey-branch-picker';
import { archetypes,messageHref,mutationError,type MessagePurpose,type MessageVersion } from './types';
import { contentOf,draftIssues,providerIssues,toDraft,type Asset,type Draft,type EditorSuggestion,type ProviderOption } from './editor-model';
export default function MessageEditor({ workspaceId,initial }: { workspaceId: string; initial?: MessageVersion }) {
  const router = useRouter(); const [draft,setDraft] = useState(() => toDraft(initial)); const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [saved,setSaved] = useState(false);
  const [assets,setAssets] = useState<Asset[]>([]); const [mediaPage,setMediaPage] = useState<{ offset: number; total: number } | null>(null);
  const [providers,setProviders] = useState<ProviderOption[] | null>(null); const [providerId,setProviderId] = useState('');
  const base = `/api/workspaces/${workspaceId}`; const content = contentOf(draft); const issues = draftIssues(draft,initial?.version);
  const provider = providers?.find((item) => item.id === providerId); const comparison = provider ? providerIssues(draft,provider) : [];
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/workspaces/${workspaceId}/messages/provider-options`,{ signal: controller.signal }).then(async (response) => { if (response.ok) { const result = await response.json(); if (!controller.signal.aborted) setProviders(result.providers); } }).catch(() => { /* No support is inferred from failed reads. */ });
    return () => controller.abort();
  },[workspaceId]);
  function update(change: Partial<Draft>) { setDraft((value) => ({ ...value,...change })); }
  function suggestion(index: number,change: Partial<EditorSuggestion>) { update({ suggestions: draft.suggestions.map((item,position) => position === index ? { ...item,...change } : item) }); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || saved || issues.length) return; setBusy(true); setError('');
    try {
      const response = await fetch(`${base}/messages${initial ? `/${initial.message_id}` : ''}`,{ method: initial ? 'PUT' : 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify({ name: draft.name,purpose: draft.purpose,...(draft.archetype?{archetype:draft.archetype}:{}),content,...(initial ? { expectedVersion: initial.version } : {}) }) });
      if (!response.ok) { setError(mutationError(response.status)); return; }
      const detail = await response.json(); setSaved(true); router.push(messageHref(detail.message.id,workspaceId)); router.refresh();
    } catch { setError('Conexão interrompida. Recarregue para conferir a versão antes de tentar novamente.'); }
    finally { setBusy(false); }
  }
  async function loadMedia(offset = 0) {
    if (busy) return; setBusy(true); setError('');
    try { const response = await fetch(`${base}/media?offset=${offset}`); if (!response.ok) throw new Error(); const result = await response.json(); setAssets(result.assets); setMediaPage({ offset,total: result.total }); }
    catch { setError('Não foi possível carregar as imagens. Tente novamente.'); } finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2*1024*1024) { setError('Use PNG, JPEG ou WebP estático de até 2 MiB.'); return; }
    setBusy(true); setError('');
    try {
      const dataBase64 = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error()); reader.onabort = () => reject(new Error()); reader.readAsDataURL(file); });
      const response = await fetch(`${base}/media`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify({ name: Array.from(file.name).slice(0,100).join(''),mimeType: file.type,dataBase64 }) });
      if (!response.ok) { setError(response.status === 400 ? 'Imagem inválida. Confira formato, dimensões e tamanho.' : mutationError(response.status)); return; }
      const { asset }: { asset: Asset } = await response.json(); update({ media: { assetId: asset.id,mimeType: asset.mime_type } });
    } catch { setError('Não foi possível enviar a imagem. Tente novamente.'); } finally { setBusy(false); }
  }
  return <Card><h2>{initial ? `Editar versão ${initial.version}` : 'Nova mensagem'}</h2><p>{initial ? 'Salvar cria uma nova versão. A versão ativa será preservada.' : 'Crie um rascunho reutilizável com texto ou rich card.'}</p><div className="messageEditorGrid">
    <form className="contactForm" onSubmit={save}><fieldset disabled={busy || saved} className="messageFields"><legend>Conteúdo</legend>
      <label>Nome da mensagem<input required value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label>Categoria<select aria-label="Categoria" value={draft.archetype??''} onChange={event=>update({archetype:event.target.value||undefined})}><option value="">Sem categoria</option>{Object.entries(archetypes[draft.purpose]).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Finalidade<select aria-label="Finalidade" value={draft.purpose} onChange={(event) => update({ purpose: event.target.value as MessagePurpose,archetype:undefined })}><option value="marketing">Marketing</option><option value="transactional">Transacional</option><option value="authentication">Autenticação</option></select></label>
      <label>Formato<select aria-label="Formato" value={draft.format} onChange={(event) => update({ format: event.target.value as Draft['format'],cards: draft.cards ?? [{title:'',body:''},{title:'',body:''}] })}><option value="text">Texto</option><option value="rich_card">Rich card</option><option value="carousel">Carrossel</option><option value="media">Imagem</option><option value="file">Arquivo de imagem</option></select></label>
      {draft.format === 'rich_card' && <label>Título<input aria-label="Título" required value={draft.title} onChange={(event) => update({ title: event.target.value })} aria-describedby="message-title-count" /><small id="message-title-count">{Array.from(draft.title).length} / 200 caracteres</small></label>}
      {(draft.format==='text' || draft.format==='rich_card') && <><label>Texto<textarea aria-label="Texto" required rows={6} value={draft.body} onChange={(event) => update({ body: event.target.value })} aria-describedby="message-text-count" /></label><small id="message-text-count">{Array.from(draft.body).length.toLocaleString('pt-BR')} / 10.000 caracteres</small></>}
      {draft.format !== 'text' && <fieldset className="messageFields"><legend>{draft.format==='carousel'?'Escolha a imagem e aplique em cada cartão':draft.format==='rich_card'?'Imagem do card (opcional)':'Imagem da mensagem'}</legend><label>Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label><p>PNG, JPEG ou WebP estático, até 2 MiB e 4096 × 4096 pixels. O upload salva uma imagem privada; salvar a mensagem é uma ação separada.</p>
        <Button type="button" variant="secondary" onClick={() => void loadMedia()}>Escolher imagem do workspace</Button>
        {mediaPage && <><div className="mediaChoices">{assets.map((asset) => <Button type="button" key={asset.id} variant="secondary" aria-pressed={draft.media?.assetId === asset.id} onClick={() => update({ media: { assetId: asset.id,mimeType: asset.mime_type } })}>{asset.name} · {asset.width} × {asset.height}</Button>)}</div>{!assets.length && <p>Nenhuma imagem nesta página.</p>}<div className="memberActions messageActions">{mediaPage.offset > 0 && <Button type="button" variant="secondary" onClick={() => void loadMedia(Math.max(0,mediaPage.offset-50))}>Imagens anteriores</Button>}{mediaPage.offset+50 < mediaPage.total && <Button type="button" variant="secondary" onClick={() => void loadMedia(mediaPage.offset+50)}>Mais imagens</Button>}</div></>}
        {draft.media && <Button type="button" variant="secondary" onClick={() => update({ media: undefined })}>Remover imagem da mensagem</Button>}
      </fieldset>}
      {draft.format==='carousel' && <fieldset className="messageFields"><legend>Cartões · {draft.cards?.length ?? 0} / 10</legend>{draft.cards?.map((card,index)=><fieldset key={index}><legend>Cartão {index+1}</legend><label>Título do cartão {index+1}<input required value={card.title} onChange={event=>update({cards:draft.cards?.map((item,i)=>i===index ? {...item,title:event.target.value} : item)})}/></label><label>Texto do cartão {index+1}<textarea required value={card.body} onChange={event=>update({cards:draft.cards?.map((item,i)=>i===index ? {...item,body:event.target.value} : item)})}/></label>{card.media && <p>Imagem vinculada ao cartão {index+1}.</p>}<Button type="button" variant="secondary" disabled={!draft.media} onClick={()=>update({cards:draft.cards?.map((item,i)=>i===index ? {...item,media:draft.media ? {...draft.media} : undefined} : item)})}>Usar imagem selecionada no cartão {index+1}</Button>{card.media && <Button type="button" variant="secondary" onClick={()=>update({cards:draft.cards?.map((item,i)=>i===index ? {...item,media:undefined} : item)})}>Remover imagem do cartão {index+1}</Button>}<Button type="button" variant="secondary" disabled={(draft.cards?.length ?? 0)<=2} onClick={()=>update({cards:draft.cards?.filter((_,i)=>i!==index)})}>Remover cartão {index+1}</Button></fieldset>)}<Button type="button" variant="secondary" disabled={(draft.cards?.length ?? 0)>=10} onClick={()=>update({cards:[...(draft.cards ?? []),{title:'',body:''}]})}>Adicionar cartão</Button></fieldset>}
      <fieldset className="messageFields"><legend>Ações e respostas sugeridas · {draft.suggestions.length} / 10</legend>{draft.suggestions.map((item,index) => <fieldset className="messageSuggestionEditor" key={index}><legend>Sugestão {index+1}</legend>
        <label>Tipo da sugestão {index+1}<select aria-label={`Tipo da sugestão ${index+1}`} value={item.destination==='journey_branch' || item.value.startsWith('journey_branch:')?'journey_branch':item.type} onChange={(event) => suggestion(index,{ type: event.target.value==='journey_branch'?'reply':event.target.value as 'reply' | 'open_url',destination:event.target.value==='journey_branch'?'journey_branch':undefined,value: '' })}><option value="reply">Resposta sugerida</option><option value="open_url">Abrir URL HTTPS</option><option value="journey_branch">Caminho da jornada</option></select></label>
        <label>Rótulo da sugestão {index+1}<input required value={item.text} onChange={(event) => suggestion(index,{ text: event.target.value })} /></label>
        {item.destination==='journey_branch' || item.value.startsWith('journey_branch:') ? <JourneyBranchPicker workspace={workspaceId} label={`Caminho da sugestão ${index+1}`} value={item.value} onChange={value=>suggestion(index,{value})}/> : <label>{item.type === 'reply' ? `Valor da resposta ${index+1}` : `URL da ação ${index+1}`}<input aria-label={item.type === 'reply' ? `Valor da resposta ${index+1}` : `URL da ação ${index+1}`} required value={item.value} onChange={(event) => suggestion(index,{ value: event.target.value })} /><small>{item.type === 'reply' ? 'Identificador devolvido quando o contato escolhe esta resposta.' : 'Use um link HTTPS para site, landing page ou WhatsApp.'}</small></label>}
        {draft.format === 'rich_card' && <label>Posição da sugestão {index+1}<select value={item.placement} onChange={(event) => suggestion(index,{ placement: event.target.value as 'message' | 'card' })}><option value="message">Após a mensagem</option><option value="card">No cartão</option></select></label>}
        <Button type="button" variant="secondary" onClick={() => update({ suggestions: draft.suggestions.filter((_item,position) => position !== index) })}>Remover sugestão {index+1}</Button>
      </fieldset>)}<Button type="button" variant="secondary" disabled={draft.suggestions.length >= 10} onClick={() => update({ suggestions: [...draft.suggestions,{ type: 'reply',text: '',value: '',placement: draft.format === 'rich_card' ? 'card' : 'message' }] })}>Adicionar sugestão</Button></fieldset>
    </fieldset><div aria-live="polite">{issues.length > 0 && <ul className="formError">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div><Button type="submit" disabled={busy || saved || issues.length > 0}>{busy ? 'Aguarde…' : saved ? 'Versão salva' : initial ? 'Salvar nova versão' : 'Criar rascunho'}</Button><p className="formError" role="alert">{error}</p></form>
    <div><h3>Prévia ao vivo</h3><MessagePreview workspaceId={workspaceId} content={content} /><label className="messageProviderLabel">Comparar com adaptador<select aria-label="Comparar com adaptador" value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">Selecione para comparar</option>{providers?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {providers === null ? <p>Capacidades indisponíveis ou em carregamento.</p> : !providers.length ? <p>Nenhum adaptador cadastrado para comparação.</p> : null}
      {provider && (comparison.length ? <ul className="formError" aria-live="polite">{comparison.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p>Compatível com as capacidades e os limites declarados pelo adaptador.</p>)}<p>A comparação não verifica agente, destinatário ou autorização de envio. Você pode salvar o rascunho independentemente do adaptador.</p>
    </div></div></Card>;
}
