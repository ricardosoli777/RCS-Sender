import Link from 'next/link';
import { LayoutDashboard, UsersRound, MessageSquare, Send, MessagesSquare, Plug, Settings, Radio, ArrowUpRight } from 'lucide-react';
import WorkspaceSelector from './workspace-selector';
import LogoutButton from './logout-button';
import { roleNames, type WorkspaceData } from './workspace';

export const modules = [
  { path: '/', label: 'Visão geral', icon: LayoutDashboard, description: 'Seu ponto de partida para a operação RCS.' },
  { path: '/contacts', label: 'Contatos', icon: UsersRound, description: 'Organize públicos e listas para suas campanhas.' },
  { path: '/messages', label: 'Mensagens', icon: MessageSquare, description: 'Crie modelos RCS reutilizáveis, com liberdade de provedor.' },
  { path: '/campaigns', label: 'Campanhas', icon: Send, description: 'Planeje envios e acompanhe a entrega das suas mensagens.' },
  { path: '/journeys', label: 'Jornadas', icon: Send, description: 'Crie sequências de mensagens conforme cada lead avança.' },
  { path: '/scoring', label: 'Pontuação', icon: UsersRound, description: 'Defina como as interações qualificam seus leads.' },
  { path: '/analytics', label: 'Resultados', icon: LayoutDashboard, description: 'Acompanhe envios, eventos e jornadas do workspace.' },
  { path: '/conversations', label: 'Conversas', icon: MessagesSquare, description: 'Acompanhe respostas e organize o atendimento.' },
  { path: '/integrations', label: 'Integrações', icon: Plug, description: 'Conecte provedores e agentes RCS ao workspace.' },
  { path: '/webhooks', label: 'Webhooks', icon: Plug, description: 'Configure chamadas das jornadas para outros sistemas.' },
  { path: '/operations', label: 'Operação', icon: Settings, description: 'Acompanhe a saúde do processamento e a auditoria.' },
  { path: '/settings', label: 'Configurações', icon: Settings, description: 'Gerencie o workspace e o acesso da sua equipe.' }
];
export function workspaceHref(path: string, id: string) { return `${path}?workspace=${encodeURIComponent(id)}`; }
export default function AppShell({ data, active, children }: { data: WorkspaceData; active: string; children: React.ReactNode }) {
  return <div className="appShell"><a className="skipLink" href="#content">Pular para o conteúdo</a>
    <aside className="sidebar"><Link prefetch={false} href={workspaceHref('/', data.selected.id)} className="brand"><span className="brandIcon"><Radio size={22} /></span>RCS Sender</Link><p className="navCaption">WORKSPACE</p>
      <nav aria-label="Navegação principal">{modules.map(({ path, label, icon: Icon }) => <Link key={path} prefetch={false} href={workspaceHref(path, data.selected.id)} aria-current={path === active ? 'page' : undefined}><Icon size={19} aria-hidden="true" /><span>{label}</span>{path === active && <span className="navDot" />}</Link>)}</nav>
      <div className="sidebarNote"><span className="signalDot" />Purple Signal<p>Uma base sólida para sua próxima mensagem.</p><span className="mono">SPEC 6.0.0</span></div>
    </aside><div className="appBody"><header className="appHeader"><WorkspaceSelector workspaces={data.workspaces} selected={data.selected.id} /><div className="profile"><span className="avatar" aria-hidden="true">{data.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{data.user.name}</strong><span>{roleNames[data.context.role]}</span></div></div><LogoutButton /></header>
      <main id="content" tabIndex={-1} className="appContent">{children}</main><footer className="appFooter"><span>RCS Sender · Purple Signal</span><span>Plataforma em desenvolvimento <ArrowUpRight size={14} aria-hidden="true" /></span></footer></div>
  </div>;
}
