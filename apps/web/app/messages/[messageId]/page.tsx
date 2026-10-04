import Link from 'next/link';
import AppShell,{ workspaceHref } from '../../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../../workspace';
import { Badge,Card } from '../../ui';
import MessagePreview from '../preview';
import MessageActions from '../actions';
import MessageEditor from '../editor';
import { purposeNames,statusNames,type MessageDetail,type MessageVersion } from '../types';
const uuid = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
export default async function MessagePage({ params,searchParams }: { params: Promise<{ messageId: string }>; searchParams: Promise<{ workspace?: string; version?: string }> }) {
  const { messageId } = await params; const query = await searchParams; const data = await workspaceData(query.workspace); if (!data) return <WorkspaceUnavailable />;
  let detail: MessageDetail | null = null; let version: MessageVersion | null = null;
  const requested = /^[1-9][0-9]{0,8}$/.test(query.version ?? '') ? Number(query.version) : null;
  try {
    if (uuid.test(messageId)) {
      const response = await apiGet(`/workspaces/${data.selected.id}/messages/${messageId}`,data.apiHeaders); if (response.ok) detail = await response.json();
      if (detail) {
        version = requested === null || requested === detail.current.version ? detail.current : requested === detail.active?.version ? detail.active : null;
        if (requested !== null && !version) { const historical = await apiGet(`/workspaces/${data.selected.id}/messages/${messageId}/versions/${requested}`,data.apiHeaders); if (historical.ok) version = (await historical.json()).version; }
      }
    }
  } catch { /* Keep failed reads distinct from successful snapshots. */ }
  const base = workspaceHref(`/messages/${messageId}`,data.selected.id);
  return <AppShell data={data} active="/messages"><Link href={workspaceHref('/messages',data.selected.id)}>← Biblioteca de mensagens</Link>
    {detail ? <><div className="pageHeading"><div><p className="eyebrow">MENSAGEM REUTILIZÁVEL</p><h1>{detail.message.name}</h1><p>{purposeNames[detail.message.purpose]} · Versão atual {detail.message.current_version} · {detail.message.active_version ? `Ativa: ${detail.message.active_version}` : 'Sem versão ativa'}</p></div><Badge>{statusNames[detail.message.status]}</Badge></div>
      <div className="settingsGrid"><Card><h2>Controle de versões</h2><p>Ativar seleciona a versão atual para reutilização. Duplicar copia a versão atual, inclusive durante uma consulta histórica. Editar uma mensagem preserva a versão ativa até você ativar a nova versão.</p>
        <MessageActions key={`${data.selected.id}:${messageId}:${detail.message.current_version}:${detail.message.status}:${detail.message.active_version}`} workspaceId={data.selected.id} detail={detail} canManage={data.context.permissions.includes('messages.manage')} />
        <p>Envios ainda não estão disponíveis.</p></Card>
        <Card><h2>Consultar conteúdo</h2><form method="get" className="memberForm"><input type="hidden" name="workspace" value={data.selected.id} /><label>Número da versão<input name="version" type="number" min={1} max={detail.message.current_version} step={1} defaultValue={requested ?? detail.message.current_version} required /></label><button type="submit">Consultar versão</button></form>
          <nav className="memberActions messageActions" aria-label="Versões da mensagem"><Link href={base}>Versão atual</Link>{detail.active && <Link href={`${base}&version=${detail.active.version}`}>Versão ativa</Link>}</nav>
          {version ? <><h3>{version.name} · Versão {version.version}</h3><p>{purposeNames[version.purpose]}{version.version !== detail.message.current_version ? ' · Consulta histórica, sem alteração do estado atual.' : ''}</p><MessagePreview workspaceId={data.selected.id} content={version.content} /></> : <p role="alert">Não foi possível carregar esta versão. Confira o número e tente novamente.</p>}
        </Card>{data.context.permissions.includes('messages.manage') && detail.message.status !== 'archived' && (requested === null || requested === detail.current.version) && <MessageEditor key={`${data.selected.id}:${messageId}:${detail.current.version}`} workspaceId={data.selected.id} initial={detail.current} />}</div></>
      : <Card><h1>Mensagem indisponível</h1><p role="alert">Não foi possível carregar esta mensagem no workspace selecionado. Volte à biblioteca ou tente novamente.</p></Card>}
  </AppShell>;
}
