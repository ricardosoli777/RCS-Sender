# Purple Signal

A interface usa os tokens da Master Spec em `apps/web/app/styles.css`, expostos pelo Tailwind CSS. Inter Variable e Geist Mono Variable são hospedadas no próprio aplicativo; ícones são Lucide. Botões seguem o padrão de variantes e composição do shadcn/ui (CVA, Slot e classes combinadas), com cards e badges compartilhados.

O AppShell organiza navegação, workspace, perfil e conteúdo. No celular, a navegação fica em uma faixa com rolagem própria. O seletor preserva a página e a query ao trocar de workspace; cada página resolve novamente o contexto na API. IDs de workspace sem vínculo mostram indisponibilidade.

O painel mostra informações reais de acesso e preparação da plataforma. Contatos, mensagens, campanhas, conversas e integrações possuem estados explícitos de construção. Não apresentam métricas fictícias nem operações de envio disponíveis.

Configurações permite a proprietários listar e adicionar contas existentes, alterar perfis e remover vínculos. Outros perfis recebem uma explicação sem carregar a lista de membros. Formulários têm rótulos, estados de progresso e feedback; a API verifica novamente as permissões e protege o último proprietário.

Diálogos usam o elemento nativo `dialog`: foco inicial em Cancelar, contenção de foco pelo navegador, Escape para fechar e confirmação explícita. Escape fica bloqueado durante a gravação. Essa abordagem preserva a CSP estrita sem estilos inline. Navegação tem indicação da página atual e link para pular ao conteúdo; controles têm altura mínima de 44 pixels e foco visível.

No celular, a tabela apresenta cada membro com seu perfil e ações visíveis. O carregamento antecipado dos links de navegação está desativado para evitar consultas autenticadas às páginas antes da abertura.

O E2E cobre alterações de equipe, negação para leitores, troca de workspace na mesma página, proteção do último proprietário e ausência de transbordamento da página em 320/375 pixels. A [CI de validação](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37130522235) passou em 03/10/2026; as capturas do painel e Configurações foram inspecionadas. Isso não constitui uma auditoria completa WCAG.
