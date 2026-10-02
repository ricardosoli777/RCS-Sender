# Workspaces

Um usuário pode participar de vários workspaces, com perfis diferentes em cada um. Contatos, mensagens, campanhas, provedores, mídia e relatórios pertencerão ao workspace quando seus módulos forem implementados. Identidade e sessão do usuário são globais; a sessão nunca concede acesso automático a outro workspace.

O cadastro cria uma conta, um workspace padrão e um vínculo `owner` na mesma transação. Contas existentes recebem seu workspace na migração 002. Quando uma conta pertence a mais de um workspace, o seletor aparece no cabeçalho. O ID selecionado é uma solicitação: o servidor sempre valida o vínculo e a permissão.

| Perfil | Permissões previstas na spec 5.3.0 |
| --- | --- |
| `owner` | Workspace, membros, provedores, contatos, mensagens, campanhas, envio, analytics e auditoria. |
| `admin` | Provedores, contatos, mensagens, campanhas, envio e analytics. |
| `operator` | Contatos, mensagens, campanhas, envio e analytics. |
| `viewer` | Visualização de contatos, mensagens, campanhas e analytics. |

Permissões são explícitas, sem hierarquia numérica de perfis. `admin` não recebe gestão de membros ou leitura de auditoria. O servidor responde 404 para workspace ausente, suspenso, arquivado ou sem vínculo ativo; responde 403 quando o vínculo existe e falta a permissão.

## API implementada

As rotas abaixo são da API. No navegador, o proxy web usa o prefixo `/api`.

| Método e rota | Acesso |
| --- | --- |
| `POST /auth/register` | Cadastro com `name`, `email`, `password`, `workspaceName`; cria workspace e sessão. |
| `POST /auth/login` | Login com `email` e `password`. |
| `GET /auth/me` | Identidade da sessão atual. |
| `POST /auth/logout` | Revoga a sessão atual. |
| `GET /workspaces` | Lista somente workspaces ativos com vínculo ativo do usuário. |
| `GET /workspaces/:workspaceId/context` | Contexto validado do workspace: usuário, workspace, perfil e permissões. |
| `GET /workspaces/:workspaceId/audit` | Até cem eventos desse workspace, com `audit.view`. |
| `GET /workspaces/:workspaceId/members` | Membros ativos desse workspace, com `members.manage`. |
| `POST /workspaces/:workspaceId/members` | Adiciona uma conta já cadastrada, com `email` e `role`; exige `members.manage`. |
| `PATCH /workspaces/:workspaceId/members/:memberId` | Altera `role`, com `members.manage`. |
| `DELETE /workspaces/:workspaceId/members/:memberId` | Remove o vínculo, com `members.manage`. |

Mutações exigem `Origin` correspondente a `APP_URL` e `X-RCS-Request: 1`. O cookie é emitido no cadastro ou login. Dados extras no cadastro, incluindo perfil ou ID de workspace, são rejeitados. A última conta proprietária ativa não pode perder o vínculo de proprietário. IDs de membros de outro workspace não são aceitos.

A inclusão de membros é feita pela API para contas já existentes; convite por e-mail e uma interface de gestão ainda não foram implementados. Não são enviados e-mails automaticamente. Mudanças de papel e remoção geram eventos no workspace afetado; workspaces próprios do membro continuam independentes.

## Persistência e auditoria

`workspace_members` tem vínculo único por par usuário/workspace. Repositórios de dados de workspace exigem `workspace_id`. `audit_logs` contém `workspace_id NOT NULL`, ator, evento, entidade, timestamp e metadados sem segredos. Eventos de identidade, incluindo login inválido sem usuário identificado, ficam em `auth_audit_logs`, sem recursos de workspace e sem consulta por usuários.

Os testes cobrem troca de ID de workspace, perfil sem permissão, vínculo removido e workspace suspenso. A execução com PostgreSQL e Redis reais continua pendente no ambiente local; veja [validação](validation.md).
