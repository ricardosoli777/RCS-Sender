import AppShell from '../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../workspace';
import { Card } from '../ui';
import ScoringEditor from './editor';
export default async function ScoringPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const data = await workspaceData((await searchParams).workspace); if (!data) return <WorkspaceUnavailable />;
  let snapshot: { revision: number; rules: { eventType: string; delta: number; enabled: boolean; goal?: string }[] } | null = null;
  try { const response = await apiGet(`/workspaces/${data.selected.id}/scoring`,data.apiHeaders); if (response.ok) snapshot = await response.json(); } catch { /* Show failed reads. */ }
  return <AppShell data={data} active="/scoring"><div className="pageHeading"><div><p className="eyebrow">QUALIFICAÇÃO DOS LEADS</p><h1>Pontuação</h1><p>Frio: 0–9 · Morno: 10–24 · Quente: 25–49 · Pronto para vendas: 50 ou mais.</p></div></div><Card>{snapshot ? <ScoringEditor key={`${data.selected.id}:${snapshot.revision}`} workspace={data.selected.id} initial={snapshot} canManage={data.context.permissions.includes('contacts.manage')} /> : <p role="alert">Não foi possível carregar as regras.</p>}</Card></AppShell>;
}
