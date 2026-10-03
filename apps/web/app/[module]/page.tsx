import Link from 'next/link';
import { notFound } from 'next/navigation';
import AppShell, { modules, workspaceHref } from '../app-shell';
import { workspaceData, WorkspaceUnavailable } from '../workspace';
import { Badge, Button, Card } from '../ui';
export default async function ModulePage({ params, searchParams }: { params: Promise<{ module: string }>; searchParams: Promise<{ workspace?: string }> }) {
  const { module } = await params;
  const section = modules.slice(1, -1).find((item) => item.path === `/${module}`);
  if (!section) notFound();
  const data = await workspaceData((await searchParams).workspace);
  if (!data) return <WorkspaceUnavailable />;
  const Icon = section.icon;
  return <AppShell data={data} active={section.path}><div className="pageHeading"><div><p className="eyebrow">OPERAÇÃO RCS</p><h1>{section.label}</h1><p>{section.description}</p></div><Badge>Em construção</Badge></div><Card className="emptyState"><span className="heroIcon"><Icon size={30} /></span><h2>Este módulo está em preparação</h2><p>Ainda não há operações disponíveis nesta seção. Você já pode organizar os acessos da equipe nas configurações do workspace.</p><Button asChild variant="secondary"><Link href={workspaceHref('/settings', data.selected.id)}>Ver configurações</Link></Button></Card></AppShell>;
}
