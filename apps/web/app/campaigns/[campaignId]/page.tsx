import Link from 'next/link';
import AppShell,{ workspaceHref } from '../../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../../workspace';
import { Badge,Card } from '../../ui';
import CampaignEditor from '../form';
import CancelCampaign from '../cancel';
import LocalReview from '../review';
import SimulationPanel from '../simulation-panel';
import DispatchPreparationPanel from '../dispatch-preparation-panel';
import DispatchPanel,{ type DispatchSummary } from '../dispatch-panel';
import { campaignStatusLabel,scheduleLabel,type Campaign,type CampaignReview,type DispatchPreparationSnapshot } from '../model';
export default async function CampaignPage({ params,searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ workspace?: string }> }) {
  const { campaignId } = await params; const data = await workspaceData((await searchParams).workspace); if (!data) return <WorkspaceUnavailable />;
  let campaign: Campaign | null = null; let review: CampaignReview | null = null;
  if (/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(campaignId)) {
    try { const response = await apiGet(`/workspaces/${data.selected.id}/campaigns/${campaignId}/review`,data.apiHeaders); if (response.ok) { review = await response.json(); campaign = review!.campaign; } } catch { /* Attempt configuration-only fallback below. */ }
    if (!campaign) { try { const response = await apiGet(`/workspaces/${data.selected.id}/campaigns/${campaignId}`,data.apiHeaders); if (response.ok) campaign = (await response.json()).campaign; } catch { /* Remain unavailable. */ } }
  }
  let preparation: DispatchPreparationSnapshot | null = null; let preparationUnavailable = false;
  if (campaign && campaign.execution_mode !== 'simulation') {
    try { const response = await apiGet(`/workspaces/${data.selected.id}/campaigns/${campaignId}/dispatch-preparation`,data.apiHeaders); if (!response.ok) throw new Error(); preparation = (await response.json()).preparation; if (campaign.execution_mode === 'dispatch' && !preparation) preparationUnavailable = true; } catch { preparationUnavailable = true; }
  }
  const canManage = data.context.permissions.includes('campaigns.manage');
  let dispatch: DispatchSummary | null = null;
  if (campaign?.execution_mode === 'dispatch') {
    try { const response = await apiGet(`/workspaces/${data.selected.id}/campaigns/${campaignId}/dispatch`,data.apiHeaders); if (response.ok) dispatch = (await response.json()).dispatch; } catch { /* Fail closed on unavailable summary. */ }
  }
  return <AppShell data={data} active="/campaigns"><Link href={workspaceHref('/campaigns',data.selected.id)}>← Campanhas do workspace</Link>
    {campaign ? <><div className="pageHeading"><div><p className="eyebrow">CONFIGURAÇÃO DE CAMPANHA</p><h1>{campaign.name}</h1><p>{campaign.objective}</p></div><Badge>{campaignStatusLabel(campaign)}</Badge></div><div className="settingsGrid"><Card><h2>Configuração salva</h2><p>Revisão {campaign.revision} · {scheduleLabel(campaign.scheduled_at)}</p><p>A versão de mensagem vinculada não muda automaticamente quando você edita a biblioteca.</p>{canManage && campaign.status === 'draft' && <CancelCampaign key={`${campaign.id}:${campaign.revision}`} workspaceId={data.selected.id} campaign={campaign} />}</Card>
      {campaign.execution_mode !== 'dispatch' && <SimulationPanel key={`SimulationPanel-${data.selected.id}:${campaign.id}:${campaign.revision}`} workspaceId={data.selected.id} campaign={campaign} canSend={data.context.permissions.includes('campaigns.send')} />}
      {campaign.execution_mode !== 'simulation' && <DispatchPreparationPanel key={`DispatchPreparationPanel-${data.selected.id}:${campaign.id}:${campaign.revision}`} workspaceId={data.selected.id} campaign={campaign} canSend={data.context.permissions.includes('campaigns.send')} initialSnapshot={preparation} unavailable={preparationUnavailable} cachedEligible={review?.eligibility.counts.eligible ?? 0} />}
      {review ? <LocalReview review={review} workspaceId={data.selected.id} /> : <Card><h2>Revisão indisponível</h2><p role="alert">Não foi possível revisar a configuração. Recarregue para tentar novamente.</p></Card>}
      {campaign.execution_mode === 'dispatch' && <DispatchPanel key={`DispatchPanel-${data.selected.id}:${campaign.id}:${campaign.revision}`} workspaceId={data.selected.id} campaignId={campaign.id} revision={campaign.revision} canSend={data.context.permissions.includes('campaigns.send')} initial={dispatch} />}
      {canManage && campaign.status === 'draft' && <CampaignEditor key={`${data.selected.id}:${campaign.id}:${campaign.revision}`} workspaceId={data.selected.id} initial={campaign} />}
    </div></> : <Card><h1>Campanha indisponível</h1><p role="alert">Não foi possível carregar esta campanha no workspace selecionado.</p></Card>}
  </AppShell>;
}
