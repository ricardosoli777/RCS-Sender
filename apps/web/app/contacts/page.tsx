import Link from 'next/link';
import AppShell, { workspaceHref } from '../app-shell';
import { apiGet, workspaceData, WorkspaceUnavailable } from '../workspace';
import { Card } from '../ui';
import ContactsPanel, { type ContactSnapshot } from './panel';

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; offset?: string }> }) {
  const query = await searchParams;
  const data = await workspaceData(query.workspace);
  if (!data) return <WorkspaceUnavailable />;
  const offset = /^(0|[1-9][0-9]{0,6})$/.test(query.offset ?? '') ? Number(query.offset) : 0;
  let snapshot: ContactSnapshot | null = null;
  try {
    const response = await apiGet(`/workspaces/${data.selected.id}/contacts?offset=${offset}`, data.apiHeaders);
    if (response.ok) snapshot = await response.json();
  } catch { /* Do not present failed persistence as an empty contact list. */ }
  return <AppShell data={data} active="/contacts"><div className="pageHeading"><div><p className="eyebrow">SEU PÚBLICO</p><h1>Contatos</h1><p>Organize contatos e listas neste workspace.</p></div></div>
    {snapshot ? <><ContactsPanel key={data.selected.id} workspaceId={data.selected.id} snapshot={snapshot} canManage={data.context.permissions.includes('contacts.manage')} />
      <nav className="memberActions" aria-label="Páginas de contatos">{offset > 0 && <Link href={`${workspaceHref('/contacts', data.selected.id)}&offset=${Math.max(0, offset - 100)}`}>Página anterior</Link>}{offset + 100 < snapshot.total && <Link href={`${workspaceHref('/contacts', data.selected.id)}&offset=${offset + 100}`}>Próxima página</Link>}</nav></>
      : <Card><h2>Contatos indisponíveis</h2><p role="alert">Não foi possível carregar os contatos. Recarregue a página para tentar novamente.</p></Card>}
  </AppShell>;
}
