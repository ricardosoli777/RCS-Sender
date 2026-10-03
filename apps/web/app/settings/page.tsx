import AppShell from '../app-shell';
import { apiGet, workspaceData, WorkspaceUnavailable, roleNames } from '../workspace';
import { Badge, Card } from '../ui';
import Members, { type Member } from './members';

export default async function Settings({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const data = await workspaceData((await searchParams).workspace);
  if (!data) return <WorkspaceUnavailable />;
  const canManage = data.context.permissions.includes('members.manage');
  let members: Member[] | null = null;
  if (canManage) {
    try {
      const response = await apiGet(`/workspaces/${data.selected.id}/members`, data.apiHeaders);
      if (response.ok) members = (await response.json()).members;
    } catch { /* A failed fetch must not become an empty member list. */ }
  }
  return <AppShell data={data} active="/settings"><div className="pageHeading"><div><p className="eyebrow">SEU WORKSPACE</p><h1>Configurações</h1><p>Organize os acessos da equipe com segurança.</p></div><Badge>{roleNames[data.context.role]}</Badge></div>
    <div className="settingsGrid"><Card><h2>Informações do workspace</h2><p>{data.selected.name}</p><p>Seu perfil: <strong>{roleNames[data.context.role]}</strong>. As permissões são verificadas em cada operação.</p></Card>
    {canManage ? members ? <Members key={data.selected.id} workspaceId={data.selected.id} members={members} /> : <Card><h2>Membros indisponíveis</h2><p role="alert">Não foi possível carregar a equipe. Recarregue a página para tentar novamente.</p></Card> : <Card><h2>Acesso da equipe</h2><p>Apenas proprietários podem gerenciar membros. Para alterar um acesso, entre em contato com o proprietário do workspace.</p></Card>}
    </div></AppShell>;
}
