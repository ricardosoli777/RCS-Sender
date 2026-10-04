import AppShell from '../../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../../workspace';
import JourneyBuilder from '../builder';
import type { JourneySnapshot } from '../model';
import type { CampaignOption } from '../../campaigns/model';
import Enrollments from '../enrollments';
import JourneyAnalytics from '../analytics';
export default async function JourneyPage({ params,searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ workspace?: string; version?: string }> }) {
  const { id } = await params; const query = await searchParams; const data = await workspaceData(query.workspace); if (!data) return <WorkspaceUnavailable />;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return <AppShell data={data} active="/journeys"><p role="alert">Jornada indisponível.</p></AppShell>;
  const version = /^[1-9][0-9]{0,6}$/.test(query.version ?? '') ? query.version : undefined; let snapshot: JourneySnapshot | null = null; const connections: CampaignOption[] = []; const messages: CampaignOption[] = [];
  try { const response = await apiGet(`/workspaces/${data.selected.id}/journeys/${id}${version ? `?version=${version}` : ''}`,data.apiHeaders); if (response.ok) snapshot = await response.json(); } catch { /* Failed reads are visible. */ }
  if (data.context.permissions.includes('journeys.manage') && data.context.permissions.includes('campaigns.manage')) for (const [kind,options] of [['connections',connections],['messages',messages]] as const) {
    try { const response = await apiGet(`/workspaces/${data.selected.id}/campaigns/options?kind=${kind}`,data.apiHeaders); if (response.ok) { const result = await response.json(); options.push(...result.options); } } catch { /* Reference validation still occurs on publication. */ }
  }
  return <AppShell data={data} active="/journeys">{snapshot ? <><JourneyBuilder key={`${data.selected.id}:${id}:${snapshot.version}:${snapshot.journey.revision}`} workspace={data.selected.id} initial={snapshot} canManage={data.context.permissions.includes('journeys.manage')} canPublish={data.context.permissions.includes('journeys.publish')} connections={connections} messages={messages} /><JourneyAnalytics workspace={data.selected.id} journey={id} version={snapshot.version} graph={snapshot.graph} /><Enrollments key={`${data.selected.id}:${id}`} workspace={data.selected.id} journey={id} active={snapshot.journey.status==='active'} canManage={data.context.permissions.includes('journeys.manage')} /></> : <p role="alert">Não foi possível carregar a jornada. Recarregue para tentar novamente.</p>}</AppShell>;
}
