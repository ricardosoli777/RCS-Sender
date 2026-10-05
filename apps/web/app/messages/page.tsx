import Link from 'next/link';
import AppShell,{ workspaceHref } from '../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../workspace';
import { Badge,Card } from '../ui';
import CreateMessage from './create-form';
import { purposeNames,statusNames,type Message,type MessageStatus } from './types';
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ workspace?: string; offset?: string; status?: string }> }) {
  const query = await searchParams; const data = await workspaceData(query.workspace); if (!data) return <WorkspaceUnavailable />;
  const offset = /^(0|[1-9][0-9]{0,6})$/.test(query.offset ?? '') ? Number(query.offset) : 0;
  const status = ['draft','active','archived'].includes(query.status ?? '') ? query.status as MessageStatus : undefined;
  let snapshot: { messages: Message[]; total: number } | null = null;
  try { const response = await apiGet(`/workspaces/${data.selected.id}/messages?offset=${offset}${status ? `&status=${status}` : ''}`,data.apiHeaders); if (response.ok) snapshot = await response.json(); } catch { /* An unavailable list is not an empty library. */ }
  const href = (nextOffset: number) => `${workspaceHref('/messages',data.selected.id)}&offset=${nextOffset}${status ? `&status=${status}` : ''}`;
  return <AppShell data={data} active="/messages"><div className="pageHeading"><div><p className="eyebrow">CONTEÚDO REUTILIZÁVEL</p><h1>Mensagens</h1><p>Prepare mensagens e escolha quais versões ficam ativas.</p></div></div><div className="settingsGrid">
    <Card><h2>Onde inserir as imagens</h2><p>No formulário <strong>Nova mensagem</strong>, escolha o formato <strong>Rich card</strong>, <strong>Carrossel</strong> ou <strong>Imagem</strong>. O campo <strong>Enviar imagem</strong> aparece logo abaixo. Você também pode reutilizar uma imagem já salva no workspace.</p><p>Salve a mensagem e ative sua versão no detalhe. Depois selecione essa mensagem na campanha ou em uma etapa <strong>Mensagem</strong> da jornada.</p></Card>
    <Card><h2>Biblioteca do workspace</h2><nav className="messageFilters" aria-label="Filtrar mensagens por estado"><Link href={workspaceHref('/messages',data.selected.id)} aria-current={!status ? 'page' : undefined}>Todas</Link>{(['draft','active','archived'] as const).map((value) => <Link key={value} href={`${workspaceHref('/messages',data.selected.id)}&status=${value}`} aria-current={status === value ? 'page' : undefined}>{statusNames[value]}</Link>)}</nav>
      {snapshot ? <><div className="tableScroll"><table><caption>{snapshot.total} mensagens neste filtro · até 50 por página</caption><thead><tr><th scope="col">Mensagem</th><th scope="col">Finalidade</th><th scope="col">Estado</th><th scope="col">Versões</th></tr></thead><tbody>{snapshot.messages.map((message) => <tr key={message.id}><td><Link href={workspaceHref(`/messages/${message.id}`,data.selected.id)}>{message.name}</Link></td><td data-label="Finalidade">{purposeNames[message.purpose]}</td><td data-label="Estado"><Badge>{statusNames[message.status]}</Badge></td><td data-label="Versões">Atual: {message.current_version}<small>{message.active_version ? `Ativa: ${message.active_version}` : 'Sem versão ativa'}</small></td></tr>)}</tbody></table></div>
        {!snapshot.messages.length && <p>{snapshot.total ? 'Nenhuma mensagem nesta página. Volte à página anterior.' : 'Nenhuma mensagem neste filtro.'}</p>}
        <nav className="memberActions messageActions" aria-label="Páginas de mensagens">{offset > 0 && <Link href={href(Math.max(0,offset-50))}>Página anterior</Link>}{offset+50 < snapshot.total && <Link href={href(offset+50)}>Próxima página</Link>}</nav></>
        : <p role="alert">Não foi possível carregar a biblioteca. Recarregue a página para tentar novamente.</p>}
    </Card>
    {data.context.permissions.includes('messages.manage') && <CreateMessage key={data.selected.id} workspaceId={data.selected.id} />}
  </div></AppShell>;
}
