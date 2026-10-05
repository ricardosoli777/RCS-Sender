import Link from 'next/link';
import { workspaceHref } from '../app-shell';

export default function EditorGuide({ workspace }: { workspace: string }) {
  return <section className="card journeyEditorGuide" aria-label="Passo a passo da jornada"><h2>Monte a sequência que cada lead vai percorrer</h2><p>Comece com: <strong>Início → Mensagem → Espera → Mensagem → Fim</strong>. Cada lead avança individualmente pelas conexões do fluxo.</p><ol className="setupSteps">
    <li><strong>Prepare o conteúdo.</strong> Em <Link href={workspaceHref('/messages',workspace)}>Mensagens</Link>, crie e ative uma mensagem para cada envio. Configure o fornecedor em <Link href={workspaceHref('/integrations',workspace)}>Integrações</Link>.</li>
    <li><strong>Adicione e configure as etapas.</strong> Clique em Mensagem ou Espera nos cards abaixo. A nova etapa abre no painel de configuração. Clique em qualquer etapa do desenho para editá-la.</li>
    <li><strong>Conecte a sequência.</strong> Selecione Início e escolha a primeira Mensagem em Próxima etapa. Repita para cada etapa até Fim. Em Condição, preencha os dois destinos: Sim e Não. A posição no desenho não define a ordem.</li>
    <li><strong>Coloque para funcionar.</strong> Aguarde “Rascunho salvo”, clique em Validar fluxo e corrija os avisos. Publicar versão fixa uma cópia do fluxo; Ativar jornada habilita a execução. Depois, em Leads nesta jornada, escolha um contato ou uma audiência para inscrever.</li>
  </ol><p>Adicionar etapas e publicar não inscreve contatos automaticamente. Ao inscrever leads numa jornada ativa, eles começam a percorrer o fluxo e as etapas de Mensagem podem enviar.</p></section>;
}
