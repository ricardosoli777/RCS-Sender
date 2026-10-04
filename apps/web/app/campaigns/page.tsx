import Link from 'next/link';
import AppShell,{ workspaceHref } from '../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../workspace';
import { Badge,Card } from '../ui';
import CampaignEditor from './form';
import { campaignHref,campaignStatusLabel,campaignStatusNames,scheduleLabel,type Campaign,type CampaignStatus } from './model';
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; offset?: string; status?: string }> }) {
  const query = await searchParams; const data = await workspaceData(query.workspace); if (!data) return <WorkspaceUnavailable />;
  const offset = /^(0|[1-9][0-9]{0,6})$/.test(query.offset ?? '') ? Number(query.offset) : 0;
  const status = Object.hasOwn(campaignStatusNames,query.status ?? '') ? query.status as CampaignStatus : undefined;
  let snapshot: { campaigns: Campaign[]; total: number } | null = null;
  try { const response = await apiGet(`/workspaces/${data.selected.id}/campaigns?offset=${offset}${status ? `&status=${status}` : ''}`,data.apiHeaders); if (response.ok) snapshot = await response.json(); } catch { /* Failed reads are not empty lists. */ }
  const href = (next: number) => `${workspaceHref('/campaigns',data.selected.id)}&offset=${next}${status ? `&status=${status}` : ''}`;
  return <AppShell data={data} active="/campaigns"><div className="pageHeading"><div><p className="eyebrow">PREPARE SEUS ENVIOS</p><h1>Campanhas</h1><p>Configure rascunhos e revise mensagem, audiência e conexão.</p></div><Badge>Execução em construção</Badge></div><div className="settingsGrid"><Card><h2>Campanhas do workspace</h2>
    <form method="get" className="memberForm"><input type="hidden" name="workspace" value={data.selected.id} /><label>Estado da campanha<select aria-label="Estado da campanha" name="status" defaultValue={status ?? ''}><option value="">Todos os estados</option>{Object.entries(campaignStatusNames).map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></label><button type="submit">Filtrar campanhas</button></form>
    {snapshot ? <><div className="tableScroll"><table><caption>{snapshot.total} campanhas neste filtro · até 50 por página</caption><thead><tr><th scope="col">Campanha</th><th scope="col">Estado</th><th scope="col">Revisão</th><th scope="col">Data configurada</th></tr></thead><tbody>{snapshot.campaigns.map((campaign) => <tr key={campaign.id}><td><Link href={campaignHref(campaign.id,data.selected.id)}>{campaign.name}</Link><small>{campaign.objective}</small></td><td data-label="Estado"><Badge>{campaignStatusLabel(campaign)}</Badge></td><td data-label="Revisão">{campaign.revision}</td><td data-label="Data configurada">{scheduleLabel(campaign.scheduled_at)}</td></tr>)}</tbody></table></div>{!snapshot.campaigns.length && <p>{snapshot.total ? 'Nenhuma campanha nesta página.' : 'Nenhuma campanha neste filtro.'}</p>}<nav className="memberActions messageActions" aria-label="Páginas de campanhas">{offset > 0 && <Link href={href(Math.max(0,offset-50))}>Página anterior</Link>}{offset+50 < snapshot.total && <Link href={href(offset+50)}>Próxima página</Link>}</nav></> : <p role="alert">Não foi possível carregar as campanhas. Recarregue para tentar novamente.</p>}
  </Card>{data.context.permissions.includes('campaigns.manage') && <CampaignEditor key={data.selected.id} workspaceId={data.selected.id} />}</div></AppShell>;
}
