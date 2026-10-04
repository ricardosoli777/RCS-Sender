import AppShell from '../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../workspace';
import EndpointEditor from './editor';
export default async function WebhooksPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const data=await workspaceData((await searchParams).workspace); if (!data) return <WorkspaceUnavailable />;
  let endpoints: { id: string; name: string; status: string; revision: number; active_version: number }[] | null=null;
  try { const response=await apiGet(`/workspaces/${data.selected.id}/webhook-endpoints`,data.apiHeaders); if (response.ok) endpoints=(await response.json()).endpoints; } catch { /* Keep failed reads visible. */ }
  return <AppShell data={data} active="/webhooks"><div className="pageHeading"><div><p className="eyebrow">INTEGRAÇÕES DAS JORNADAS</p><h1>Webhooks de saída</h1><p>Os nós usam a versão do endpoint fixada na publicação da jornada.</p></div></div>{endpoints ? <EndpointEditor key={`${data.selected.id}:${endpoints.map((e) => `${e.id}:${e.revision}`).join(',')}`} workspace={data.selected.id} endpoints={endpoints} canManage={data.context.permissions.includes('providers.manage')} /> : <p role="alert">Não foi possível carregar os endpoints.</p>}</AppShell>;
}
