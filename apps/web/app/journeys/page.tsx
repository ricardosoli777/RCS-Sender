import Link from 'next/link';
import AppShell,{ workspaceHref } from '../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../workspace';
import { Badge,Card } from '../ui';
import CreateJourney from './create';
import JourneyGuide from './guide';
import { journeyHref,journeyLabels,type Journey } from './model';
export default async function JourneysPage({ searchParams }: { searchParams: Promise<{ workspace?: string; offset?: string }> }) {
  const query = await searchParams; const data = await workspaceData(query.workspace); if (!data) return <WorkspaceUnavailable />;
  const offset = /^(0|[1-9][0-9]{0,6})$/.test(query.offset ?? '') ? Number(query.offset) : 0; let result: { journeys: Journey[]; total: number } | null = null;
  try { const response = await apiGet(`/workspaces/${data.selected.id}/journeys?offset=${offset}`,data.apiHeaders); if (response.ok) result = await response.json(); } catch { /* Expose failed reads. */ }
  return <AppShell data={data} active="/journeys"><div className="pageHeading"><div><p className="eyebrow">CONSTRUA SEU FUNIL</p><h1>Jornadas</h1><p>Mensagens, esperas e caminhos para cada etapa do lead.</p></div></div><div className="settingsGrid"><JourneyGuide workspace={data.selected.id}/><Card><h2>Jornadas do workspace</h2>{result ? <><div className="tableScroll"><table><caption>{result.total} jornadas · até 50 por página</caption><thead><tr><th>Nome</th><th>Estado</th><th>Versão publicada</th></tr></thead><tbody>{result.journeys.map((journey) => <tr key={journey.id}><td><Link href={journeyHref(journey.id,data.selected.id)}>{journey.name}</Link></td><td><Badge>{journeyLabels[journey.status] ?? journey.status}</Badge></td><td>{journey.published_version ?? '—'}</td></tr>)}</tbody></table></div>{!result.journeys.length && <p>Nenhuma jornada nesta página.</p>}<nav aria-label="Páginas de jornadas">{offset>0 && <Link href={`${workspaceHref('/journeys',data.selected.id)}&offset=${Math.max(0,offset-50)}`}>Página anterior</Link>}{offset+50<result.total && <Link href={`${workspaceHref('/journeys',data.selected.id)}&offset=${offset+50}`}>Próxima página</Link>}</nav></> : <p role="alert">Não foi possível carregar as jornadas.</p>}</Card>{data.context.permissions.includes('journeys.manage') && <Card><CreateJourney workspace={data.selected.id} /></Card>}</div></AppShell>;
}
