# Arquitetura

O RCS Sender será um monólito modular em um monorepo pnpm. `apps/web` apresenta a interface, `apps/api` expõe HTTP e `apps/worker` processa tarefas. O backend usa PostgreSQL para persistência e Redis com BullMQ para filas. O domínio de mensagens e campanhas não conhece payloads dos provedores; os adaptadores traduzem contratos canônicos.

Na especificação 5.3.0, a arquitetura adota workspaces como fronteira de dados. Usuários são identidades globais; `workspace_members` associa um usuário a um workspace com perfil e estado próprios. Recursos de operação e seus índices devem carregar `workspace_id`. Jobs, cache, mídia e webhooks receberão esse contexto nas respectivas waves.

O cadastro grava usuário, workspace padrão, vínculo `owner`, sessão e eventos em uma transação. A migração 002 cria workspaces e memberships para usuários existentes, sem atribuir papéis globais. Sessões pertencem à identidade do usuário; acesso a cada workspace exige uma nova validação no servidor.

Os módulos de autenticação e workspaces estão em `apps/api/src/modules`, com contratos de domínio, aplicação, infraestrutura PostgreSQL e apresentação HTTP. O servidor autentica, valida o vínculo ativo e constrói o `WorkspaceContext`. Repositórios de auditoria e membros exigem o workspace explicitamente. Nenhum papel recebido no cadastro ou ID de workspace enviado pelo cliente concede acesso.

`audit_logs` armazena operações de workspace com `workspace_id NOT NULL`. O log inicial é preservado como `auth_audit_logs`, destinado exclusivamente a eventos de identidade, incluindo login inválido sem usuário conhecido. Ele não contém dados operacionais de workspaces nem possui endpoint de consulta para usuários.

O frontend usa um proxy no próprio servidor Next.js para rotas aprovadas da API. Credenciais e `API_URL` ficam fora do código enviado ao navegador. O proxy preserva cookie HttpOnly e origem da requisição, limita corpos a 8 KiB e não confia em cabeçalhos de IP enviados pelo cliente.

O prazo de dez segundos do proxy inclui leitura do corpo e comunicação com a API. Uploads interrompidos são cancelados antes de encaminhar um corpo incompleto. Cabeçalhos de segurança são aplicados pelo Next.js. O `proxy.ts` gera nonces de script por requisição; o layout força renderização dinâmica para que os scripts do framework recebam o mesmo nonce. Cabeçalhos CSP e nonce enviados pelo cliente são sobrescritos.

O IP usado pelos limites Redis pode vir de um proxy público autenticado com `RCS_EDGE_PROXY_SECRET`. A interface valida um IP único e encaminha-o à API com um segredo distinto, `RCS_API_PROXY_SECRET`; a API exige origem loopback. Essa mesma validação atende rotas web e consultas feitas pela página no servidor. Nenhum segredo é disponibilizado ao JavaScript do navegador.

O pacote `@rcs/security` fornece criptografia autenticada AES-256-GCM para credenciais futuras. O texto cifrado inclui versão da chave, nonce e tag; o contexto da conexão é autenticado junto com o conteúdo. A persistência e a rotação operacional das chaves ainda não estão integradas à API.
