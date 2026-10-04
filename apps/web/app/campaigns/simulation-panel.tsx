'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button,Card } from '../ui';
import { campaignStatusLabel,type Campaign,type SimulationSnapshot } from './model';
export default function SimulationPanel({ campaign,workspaceId,canSend }: { campaign: Campaign; workspaceId: string; canSend: boolean }) {
  const router = useRouter(); const [snapshot,setSnapshot] = useState<SimulationSnapshot | null>(null); const [pending,setPending] = useState(true); const [error,setError] = useState('');
  const base = `/api/workspaces/${workspaceId}/campaigns/${campaign.id}/simulation`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/workspaces/${workspaceId}/campaigns/${campaign.id}/simulation`,{ signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(); const data = await response.json(); if (!controller.signal.aborted) setSnapshot(data.simulation); }).catch(() => { if (!controller.signal.aborted) setError('Não foi possível carregar a simulação. Recarregue a página.'); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  },[workspaceId,campaign.id]);
  async function mutate(operation: 'prepare' | 'step' | 'pause' | 'resume' | 'cancel' | 'stop' | 'enqueue') {
    if (pending || !canSend || error) return;
    if (operation === 'prepare' && !window.confirm('Preparar uma simulação local com a configuração salva? A audiência e a configuração serão congeladas. Nenhuma mensagem real será enviada.')) return;
    if (operation === 'enqueue' && !window.confirm('Executar os lotes desta simulação em segundo plano, após a data configurada? Nenhuma mensagem real será enviada.')) return;
    if ((operation === 'cancel' || operation === 'stop') && !window.confirm('Encerrar os contatos pendentes desta simulação? Os resultados anteriores serão preservados.')) return;
    setPending(true); setError('');
    const expectedRevision = snapshot?.campaign.revision ?? campaign.revision;
    try {
      const response = await fetch(`${base}/${['prepare','step','enqueue'].includes(operation) ? operation : 'control'}`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify({ expectedRevision,...(operation === 'prepare' || operation === 'enqueue' ? { mode: 'simulation' } : operation === 'step' ? {} : { action: operation }) }) });
      if (!response.ok) { setError(response.status === 409 ? 'A revisão, o estado, a data ou a audiência não permitem esta operação. Recarregue e confira a mensagem ativa e a lista.' : response.status === 403 ? 'Seu perfil não permite controlar a simulação.' : 'Não foi possível atualizar. Recarregue para conferir o estado da simulação.'); return; }
      const data = await response.json(); setSnapshot(data.simulation); router.refresh();
    } catch { setError('Conexão interrompida. Recarregue para conferir os resultados antes de tentar novamente.'); } finally { setPending(false); }
  }
  const status = snapshot?.campaign.status;
  const waitingForDate = !!snapshot?.run.not_before && Date.parse(snapshot.run.not_before) > Date.now();
  return <Card><h2>Simulação local de execução</h2><p>Este modo registra o avanço dos contatos em PostgreSQL. Não usa fornecedores, credenciais ou rede RCS e não comprova entrega.</p>
    {pending && <p role="status">Carregando ou processando a simulação…</p>}<p role="alert" className="formError">{error}</p>
    {snapshot ? <><p>{campaignStatusLabel(snapshot.campaign)} · Revisão {snapshot.campaign.revision}</p><dl className="campaignTotals"><div><dt>Contatos congelados</dt><dd>{snapshot.counts.total}</dd></div><div><dt>Pendentes</dt><dd>{snapshot.counts.pending}</dd></div><div><dt>Simulados</dt><dd>{snapshot.counts.simulated}</dd></div><div><dt>Suprimidos por opt-out</dt><dd>{snapshot.counts.suppressed}</dd></div><div><dt>Cancelados</dt><dd>{snapshot.counts.cancelled}</dd></div></dl>
      {canSend && <div className="memberActions messageActions">{['ready','scheduled','running'].includes(status ?? '') && <><Button disabled={pending || !!error || waitingForDate} onClick={() => void mutate('step')}>Processar até 50 contatos (simulação)</Button><Button variant="secondary" disabled={pending || !!error} onClick={() => void mutate('pause')}>Pausar simulação</Button></>}{status === 'paused' && <Button disabled={pending || !!error} onClick={() => void mutate('resume')}>Retomar simulação</Button>}{['ready','scheduled','running','paused'].includes(status ?? '') && <><Button variant="secondary" disabled={pending || !!error} onClick={() => void mutate('cancel')}>Cancelar simulação</Button><Button variant="danger" disabled={pending || !!error} onClick={() => void mutate('stop')}>Parar simulação</Button></>}</div>}
      {snapshot.automation && <p role="status">{snapshot.automation.status === 'pending' ? 'Processamento em segundo plano solicitado. Requer worker, PostgreSQL e Redis disponíveis; recarregue para consultar o avanço.' : snapshot.automation.status === 'dead' ? 'O lote falhou após cinco tentativas. Confira o worker antes de solicitar novamente.' : snapshot.automation.status === 'discarded' ? 'A solicitação anterior foi interrompida ou invalidada. Retomar a campanha exige solicitar novamente o processamento em segundo plano.' : 'Último lote em segundo plano finalizado.'}</p>}
      {canSend && ['ready','scheduled','running'].includes(status ?? '') && <Button disabled={pending || !!error || snapshot.automation?.status === 'pending'} onClick={() => void mutate('enqueue')}>Executar simulação em segundo plano</Button>}
      <p>A data configurada precisa chegar antes de processar um lote. O processamento em segundo plano depende do worker; para um lote manual, recarregue após a data. Pausa e parada interrompem a solicitação automática e preservam resultados finalizados.</p></>
      : !pending && !error && <><p>A preparação usa a configuração salva; salve suas alterações antes de preparar. Preparar requer uma versão ativa de mensagem, uma lista com contatos sem opt-out e até 5.000 contatos no total. Uma conexão real não é necessária para esta simulação.</p>{canSend && campaign.status === 'draft' && <Button disabled={!campaign.audience_list_id || !campaign.message_version_id} onClick={() => void mutate('prepare')}>Preparar simulação local</Button>}</>}
  </Card>;
}
