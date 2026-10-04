import Link from 'next/link';
import AppShell,{ workspaceHref } from '../../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../../workspace';
import ConversationPanel,{ type ConversationSnapshot } from '../panel';
export default async function ConversationPage({ params,searchParams }: { params: Promise<{ conversationId: string }>; searchParams: Promise<{ workspace?: string; offset?: string }> }) {
  const { conversationId } = await params; const query = await searchParams; const data = await workspaceData(query.workspace); if (!data) return <WorkspaceUnavailable />;
  const offset = /^(0|[1-9][0-9]{0,6})$/.test(query.offset ?? '') ? Number(query.offset) : 0; let snapshot: ConversationSnapshot | null = null;
  if (/^[a-f0-9-]{36}$/i.test(conversationId)) try { const response = await apiGet(`/workspaces/${data.selected.id}/conversations/${conversationId}?offset=${offset}`,data.apiHeaders); if (response.ok) snapshot = await response.json(); } catch { /* Private content remains unavailable on failed reads. */ }
  return <AppShell data={data} active="/conversations"><Link href={workspaceHref('/conversations',data.selected.id)}>← Conversas</Link>{snapshot ? <ConversationPanel key={`${data.selected.id}:${conversationId}:${snapshot.conversation.revision}:${offset}`} workspace={data.selected.id} snapshot={snapshot} userId={data.user.id} canManage={data.context.permissions.includes('conversations.manage')} canReply={data.context.permissions.includes('campaigns.send')} /> : <p role="alert">Não foi possível carregar esta conversa.</p>}<nav aria-label="Histórico da conversa">{offset>0 && <Link href={`${workspaceHref(`/conversations/${conversationId}`,data.selected.id)}&offset=${Math.max(0,offset-50)}`}>Mensagens mais recentes</Link>}{snapshot?.messages.length===50 && <Link href={`${workspaceHref(`/conversations/${conversationId}`,data.selected.id)}&offset=${offset+50}`}>Mensagens anteriores</Link>}</nav></AppShell>;
}
