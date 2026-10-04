'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button,Card } from '../ui';
export type DispatchSummary = { campaignId: string; revision: number; runId: string | null; executionAvailable: boolean; status?:string; remoteEvidence?:{delivered:number;read:number;failed:number;uncertainWithEvidence:number}; counts: { pending: number; processing: number; completed: number; unresolved: number; discarded: number; dead: number } };
export default function DispatchPanel({ workspaceId,campaignId,revision,canSend,initial }: { workspaceId: string; campaignId: string; revision: number; canSend: boolean; initial: DispatchSummary | null }) {
  const router = useRouter(); const [pending,setPending] = useState(false); const [blocked,setBlocked] = useState(false); const [message,setMessage] = useState('');
  const consistent = !!initial && initial.campaignId === campaignId && initial.revision === revision;
  const total = initial ? Object.values(initial.counts).reduce((sum,count) => sum+count,0) : 0;
  const ready = consistent && initial.executionAvailable && !!initial.runId && total === 0;
  async function enqueue() {
    if (!ready || !canSend || pending || blocked) return;
    if (!window.confirm('Enfileirar os destinatários elegíveis da preparação confirmada? O worker poderá enviar a mensagem pela conexão escolhida a partir da data salva. Consentimento, opt-out e elegibilidade serão revalidados.')) return;
    setPending(true);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/campaigns/${encodeURIComponent(campaignId)}/dispatch/enqueue`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify({ mode: 'dispatch',expectedRevision: revision,runId: initial!.runId }),signal: AbortSignal.timeout(10000) });
      setBlocked(true);
      if (!response.ok) { setMessage(response.status === 409 ? 'A configuração ou a disponibilidade mudou. Recarregue para conferir a fila antes de tentar novamente.' : 'Não foi possível confirmar a operação. Recarregue para conferir a fila.'); return; }
      setMessage('Fila registrada. Recarregue para acompanhar os resultados.'); router.refresh();
    } catch { setBlocked(true); setMessage('Resultado não confirmado. Recarregue para conferir a fila antes de tentar novamente.'); }
    finally { setPending(false); }
  }
  async function control(action:'pause'|'resume'|'stop') {
    if(!consistent || !canSend || pending || blocked || !confirm(action==='stop'?'Parar os envios pendentes? Tentativas já iniciadas serão preservadas.':action==='pause'?'Pausar os envios ainda não reservados?':'Retomar os envios pendentes com as condições atuais de cada contato?'))return;
    setPending(true);try{const response=await fetch(`/api/workspaces/${workspaceId}/campaigns/${campaignId}/dispatch/control`,{method:'POST',headers:{'content-type':'application/json','x-rcs-request':'1'},body:JSON.stringify({expectedRevision:revision,action}),signal:AbortSignal.timeout(10000)});setBlocked(true);if(!response.ok)throw new Error();setMessage('Controle registrado. Recarregue para acompanhar a fila.');router.refresh();}catch{setBlocked(true);setMessage('Controle não confirmado. Recarregue antes de tentar novamente.');}finally{setPending(false);}
  }
  return <Card><h2>Fila de despacho</h2><p>Enfileirar é uma operação separada de preparar e confirmar. O envio respeita a data salva e as condições atuais de cada contato.</p>
    {!consistent ? <p role="alert">Não foi possível carregar a fila nesta revisão. Recarregue para conferir.</p> : <>
      <dl className="campaignTotals"><div><dt>Aguardando</dt><dd>{initial.counts.pending}</dd></div><div><dt>Em processamento</dt><dd>{initial.counts.processing}</dd></div><div><dt>Tentativas finalizadas</dt><dd>{initial.counts.completed}</dd></div><div><dt>Resultado inconclusivo</dt><dd>{initial.counts.unresolved}</dd></div><div><dt>Descartados</dt><dd>{initial.counts.discarded}</dd></div><div><dt>Falhas antes da tentativa</dt><dd>{initial.counts.dead}</dd></div></dl>
      <p>Tentativas finalizadas incluem aceite e rejeição; esta contagem não comprova entrega. Resultados inconclusivos não são reenviados automaticamente.</p>
      {initial.remoteEvidence && <><h3>Retornos autenticados do fornecedor</h3><p>Entregues: {initial.remoteEvidence.delivered} · Lidas: {initial.remoteEvidence.read} · Falhas informadas: {initial.remoteEvidence.failed}</p>{initial.remoteEvidence.uncertainWithEvidence>0 && <p>{initial.remoteEvidence.uncertainWithEvidence} tentativa(s) sem resposta conclusiva no envio receberam evidência posterior. O registro original permanece preservado.</p>}</>}
      {!initial.executionAvailable && total === 0 && <p>Despacho indisponível para esta configuração. Confira a preparação confirmada e a disponibilidade da conexão.</p>}
      {canSend && total === 0 && <Button disabled={!ready || pending || blocked} onClick={() => void enqueue()}>Enfileirar preparação confirmada</Button>}
      {canSend && total>0 && ['ready','queued','running','paused'].includes(initial.status??'') && <div>{initial.status==='paused'?<Button disabled={pending || blocked} onClick={()=>void control('resume')}>Retomar despacho</Button>:<Button disabled={pending || blocked} onClick={()=>void control('pause')}>Pausar despacho</Button>}<Button disabled={pending || blocked} onClick={()=>void control('stop')}>Parar despacho</Button></div>}
    </>}
    {pending && <p role="status">Registrando fila…</p>}{message && <p role="status">{message}</p>}{blocked && <Button variant="secondary" onClick={() => window.location.reload()}>Recarregar fila</Button>}
  </Card>;
}
