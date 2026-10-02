import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LogoutButton from './logout-button';
import WorkspaceSelector from './workspace-selector';

const sections = [
  { title: 'Contatos', description: 'Públicos e listas para suas campanhas.' },
  { title: 'Mensagens', description: 'Modelos RCS reutilizáveis e independentes de provedor.' },
  { title: 'Campanhas', description: 'Planejamento, envio e acompanhamento em um só lugar.' },
  { title: 'Integrações', description: 'Conecte provedores e agentes RCS.' }
];

export default async function Home({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const cookie = (await cookies()).toString();
  let authenticated = false;
  try {
    if (process.env.API_URL && cookie) {
      const response = await fetch(new URL('/auth/me', process.env.API_URL), {
        headers: { cookie }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(5000)
      });
      authenticated = response.ok;
    }
  } catch { /* Login remains available while the API is unavailable. */ }
  if (!authenticated) redirect('/login');
  const { workspace: requestedWorkspace } = await searchParams;
  let workspaces: { id: string; name: string; role: string }[] = [];
  let selected = '';
  let workspaceUnavailable = false;
  try {
    const response = await fetch(new URL('/workspaces', process.env.API_URL!), {
      headers: { cookie }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Workspace indisponível');
    workspaces = (await response.json()).workspaces;
    selected = requestedWorkspace ?? workspaces[0]?.id ?? '';
    if (!workspaces.some((item) => item.id === selected)) throw new Error('Workspace indisponível');
    const context = await fetch(new URL(`/workspaces/${selected}/context`, process.env.API_URL!), {
      headers: { cookie }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(5000)
    });
    if (!context.ok) throw new Error('Workspace indisponível');
  } catch { workspaceUnavailable = true; }
  if (workspaceUnavailable) return <main className="shell loginShell"><h1>Workspace indisponível</h1>
    <p>Você precisa de um vínculo ativo com o workspace para acessá-lo. Tente novamente ou entre em contato com o proprietário.</p>
    <a href="/">Voltar ao meu workspace</a><LogoutButton /></main>;
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brandIcon">◈</span> RCS Sender</div><WorkspaceSelector workspaces={workspaces} selected={selected} /><LogoutButton /></header>
    <section className="hero"><p className="eyebrow">SIMPLE OUTSIDE · ROBUST INSIDE</p><h1>Mensagens que chegam.<br/><span>Operação que escala.</span></h1><p className="intro">Crie mensagens e campanhas RCS em uma plataforma independente de provedores. A fundação técnica está sendo construída por etapas.</p><div className="heroMeta"><span>● Plataforma em desenvolvimento</span><span>Spec 5.3.0</span></div></section>
    <section className="modules" aria-label="Módulos previstos">{sections.map((section) => <article className="card" key={section.title}><div className="cardMark">↗</div><h2>{section.title}</h2><p>{section.description}</p></article>)}</section>
    <footer>RCS Sender · Purple Signal</footer>
  </main>;
}
