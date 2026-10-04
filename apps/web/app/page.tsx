import Link from 'next/link';
import { ArrowRight, ShieldCheck, UsersRound, Radio } from 'lucide-react';
import AppShell, { modules, workspaceHref } from './app-shell';
import { workspaceData, WorkspaceUnavailable, roleNames } from './workspace';
import { Badge, Button, Card } from './ui';
export default async function Home({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const data = await workspaceData((await searchParams).workspace);
  if (!data) return <WorkspaceUnavailable />;
  return <AppShell data={data} active="/">
    <div className="pageHeading"><div><p className="eyebrow">SEU ESPAÇO DE TRABALHO</p><h1>Visão geral</h1><p>Olá, {data.user.name}. Vamos preparar sua operação.</p></div><Badge>Em desenvolvimento</Badge></div>
    <Card className="welcomeCard"><div><span className="heroIcon"><Radio size={30} /></span><h2>O próximo sinal começa aqui.</h2><p>Seu workspace já está pronto para receber a equipe. Os módulos de envio serão disponibilizados nas próximas etapas.</p><Button asChild><Link prefetch={false} href={workspaceHref('/settings', data.selected.id)}>Configurar workspace <ArrowRight size={17} /></Link></Button></div><div className="signalArt" aria-hidden="true"><span /><span /><span /><Radio size={64} /></div></Card>
    <div className="summaryGrid"><Card><UsersRound size={20} /><p>Workspace ativo</p><strong>{data.selected.name}</strong></Card><Card><ShieldCheck size={20} /><p>Seu perfil de acesso</p><strong>{roleNames[data.context.role]}</strong></Card><Card><Radio size={20} /><p>Operação RCS</p><strong>Em preparação</strong><small>Os envios ainda não estão disponíveis.</small></Card></div>
    <div className="sectionHeading"><h2>Explore a plataforma</h2><p>Uma operação, do público à conversa.</p></div>
    <div className="moduleGrid">{modules.slice(1, -1).map(({ path, label, description, icon: Icon }) => <Link key={path} prefetch={false} className="moduleCard" href={workspaceHref(path, data.selected.id)}><span className="moduleIcon"><Icon size={21} /></span><ArrowRight className="moduleArrow" size={18} /><h3>{label}</h3><p>{description}</p><span className="moduleStatus">{path === '/messages' ? 'Biblioteca disponível' : 'Em construção'}</span></Link>)}</div>
  </AppShell>;
}
