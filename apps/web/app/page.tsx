const sections = [
  { title: 'Contatos', description: 'Públicos e listas para suas campanhas.' },
  { title: 'Mensagens', description: 'Modelos RCS reutilizáveis e independentes de provedor.' },
  { title: 'Campanhas', description: 'Planejamento, envio e acompanhamento em um só lugar.' },
  { title: 'Integrações', description: 'Conecte provedores e agentes RCS.' }
];

export default function Home() {
  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brandIcon">◈</span> RCS Sender</div><span className="stage">Fundação em construção</span></header>
    <section className="hero"><p className="eyebrow">SIMPLE OUTSIDE · ROBUST INSIDE</p><h1>Mensagens que chegam.<br/><span>Operação que escala.</span></h1><p className="intro">Crie mensagens e campanhas RCS em uma plataforma independente de provedores. A fundação técnica está sendo construída por etapas.</p><div className="heroMeta"><span>● Plataforma em desenvolvimento</span><span>Spec 5.2.0</span></div></section>
    <section className="modules" aria-label="Módulos previstos">{sections.map((section) => <article className="card" key={section.title}><div className="cardMark">↗</div><h2>{section.title}</h2><p>{section.description}</p></article>)}</section>
    <footer>RCS Sender · Purple Signal</footer>
  </main>;
}
