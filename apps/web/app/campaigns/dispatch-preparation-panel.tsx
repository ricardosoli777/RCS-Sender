'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button,Card } from '../ui';
import type { Campaign,DispatchPreparationSnapshot } from './model';

export default function DispatchPreparationPanel({ campaign,workspaceId,canSend,initialSnapshot,unavailable,cachedEligible }: { campaign: Campaign; workspaceId: string; canSend: boolean; initialSnapshot: DispatchPreparationSnapshot | null; unavailable: boolean; cachedEligible: number }) {
  const router = useRouter(); const [snapshot,setSnapshot] = useState(initialSnapshot); const [pending,setPending] = useState(false); const [error,setError] = useState('');
  const inconsistent = !!initialSnapshot && (initialSnapshot.campaignId !== campaign.id || initialSnapshot.revision !== campaign.revision);
  const blocked = unavailable || inconsistent || pending || !!error;
  const configured = !!campaign.provider_connection_id && !!campaign.agent_id && !!campaign.message_version_id && !!campaign.audience_list_id && cachedEligible>0;
  async function mutate(operation: 'prepare' | 'confirm' | 'cancel') {
    if (blocked || !canSend) return;
    const prompt = operation === 'prepare' ? 'Congelar a audiência e a configuração salvas para preparar o despacho? Esta preparação não envia mensagens e não pode ser editada.' : operation === 'confirm' ? 'Confirmar a audiência e a mensagem congeladas? A confirmação será registrada. Enfileirar é uma operação separada.' : 'Cancelar esta preparação? A audiência e a confirmação anteriores permanecerão no histórico.';
    if (!window.confirm(prompt)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/campaigns/${campaign.id}/dispatch-preparation/${operation}`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify({ expectedRevision: snapshot?.revision ?? campaign.revision,mode: 'dispatch',...(operation === 'prepare' ? {} : { runId: snapshot?.runId }) }) });
      if (!response.ok) { setError(response.status === 409 ? 'A revisão ou as condições atuais não permitem esta operação. Recarregue e confira conexão, mensagem ativa, elegibilidade e tentativas anteriores.' : response.status === 403 ? 'Seu perfil não permite alterar esta preparação.' : 'Não foi possível atualizar a preparação. Recarregue para conferir o estado salvo.'); return; }
      setSnapshot((await response.json()).preparation); router.refresh();
    } catch { setError('Conexão interrompida. Recarregue para conferir o estado salvo antes de tentar novamente.'); } finally { setPending(false); }
  }
  return <Card><h2>Preparação de despacho</h2><p>Congela a audiência e a mensagem escolhidas para uma futura execução. Preparar ou confirmar não envia mensagens. A fila de despacho tem sua própria ação de enfileiramento.</p>
    {(unavailable || inconsistent) && <p role="alert">Não foi possível carregar uma preparação compatível com esta revisão. Recarregue antes de continuar.</p>}
    {pending && <p role="status">Salvando a preparação…</p>}{error && <p role="alert" className="formError">{error}</p>}
    {snapshot ? <><p>{snapshot.status === 'cancelled' ? 'Preparação cancelada' : snapshot.confirmed ? 'Configuração congelada confirmada' : 'Configuração congelada aguardando confirmação'} · Revisão {snapshot.revision}</p>
      <dl className="campaignTotals"><div><dt>Contatos congelados</dt><dd>{snapshot.counts.total}</dd></div><div><dt>Elegíveis na preparação</dt><dd>{snapshot.counts.eligible}</dd></div><div><dt>Suprimidos por opt-out</dt><dd>{snapshot.counts.suppressed}</dd></div><div><dt>Sem elegibilidade válida na preparação</dt><dd>{snapshot.counts.unavailable}</dd></div></dl>
      <p>Estas contagens representam o momento da preparação. Contatos adicionados à lista não entram nesta execução; opt-outs e elegibilidade serão verificados novamente antes de qualquer despacho.</p>
      <p>A confirmação da configuração não comprova consentimento dos contatos. {snapshot.confirmed && 'A confirmação permanece no histórico mesmo após cancelamento.'}</p>
      {canSend && snapshot.status === 'ready' && <div className="memberActions messageActions">{!snapshot.confirmed && <Button disabled={blocked} onClick={() => void mutate('confirm')}>Confirmar configuração congelada</Button>}<Button variant="danger" disabled={blocked} onClick={() => void mutate('cancel')}>Cancelar preparação</Button></div>}
    </> : !unavailable && !inconsistent && <><p>Use a configuração salva com conexão e agente vinculados, texto simples sem sugestões e lista de até 5.000 contatos. É necessário ao menos um check de elegibilidade válido. As condições são revalidadas ao preparar.</p>
      {canSend && campaign.status === 'draft' && !campaign.execution_mode && <><Button disabled={blocked || !configured} onClick={() => void mutate('prepare')}>Preparar configuração de despacho</Button>{!configured && <p>Complete a configuração e confira a elegibilidade salva antes de preparar.</p>}</>}
    </>}
  </Card>;
}
