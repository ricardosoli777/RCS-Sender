# Contatos e Audiências — Wave 8

Implementação local em 03/10/2026. A página `/contacts` oferece cadastro manual, importação CSV/colagem, criação/exclusão de listas e registro de opt-out. Proprietários, administradores e operadores gerenciam; leitores consultam. Trocar de workspace reinicia o formulário. A listagem mostra até 100 contatos por página, com navegação e total do workspace.

Telefones usam [`libphonenumber-js/max`](https://github.com/catamphetamine/libphonenumber-js) com país padrão BR, validação por metadados e saída E.164. Não extrair telefones de texto livre, aceitar extensões ou remover letras silenciosamente. A validação de formato não comprova existência, consentimento ou elegibilidade RCS.

Importações aceitam até 500 registros e 64 KiB de texto UTF-8; a requisição JSON tem limite de 128 KiB para comportar escapes. CSV aceita vírgula, ponto e vírgula ou tabulação, cabeçalho opcional `telefone,nome`/`phone,name`, campos entre aspas e aspas duplicadas. A primeira coluna é o telefone e a segunda, opcional, o nome. Colunas extras ou estrutura inválida rejeitam o arquivo antes de persistir. Linhas com telefone/nome inválido são ignoradas e informadas pelo índice do registro de dados, a partir de 1, sem contar cabeçalho ou linhas vazias. Não são números físicos de linha quando houver campos multilinha.

O relatório separa criados, duplicados, bloqueados por opt-out e registros inválidos. Duplicatas usam telefone normalizado por workspace e preservam o nome existente. Importar novamente permite vincular contatos existentes a outra lista. Contatos podem pertencer a várias listas. Excluir uma lista remove somente seus vínculos; os contatos são preservados. Chaves estrangeiras compostas impedem vínculos entre workspaces.

O opt-out é persistente por `(workspace_id, phone_normalized)` e independente das listas e do registro do contato. Reimportar não reativa um número bloqueado. A contagem de uma lista inclui todos os seus contatos, inclusive bloqueados; não é uma contagem de destinatários autorizados. Não há reativação implícita nem envio neste módulo. Preflight e checagem imediatamente antes do envio pertencem ao futuro Campaign Engine e deverão consultar essa supressão.

Cada transação revalida workspace, conta e vínculo ativos no banco. Escritas exigem proprietário, administrador ou operador atuais, usando o mesmo lock de workspace das mudanças de membros. Auditoria é atômica: sua falha desfaz importação, exclusão de lista e opt-out. Metadados de auditoria contêm apenas IDs e contagens, sem nomes ou telefones importados.

| Rota | Operação |
| --- | --- |
| `GET /workspaces/:workspaceId/contacts?offset=0` | Contatos paginados, total e listas com contagem. |
| `POST /workspaces/:workspaceId/contacts` | Cadastro manual: `phone`, `name` opcional. |
| `POST /workspaces/:workspaceId/contacts/import` | Exatamente um de `contacts` ou `text`; `listId` opcional do mesmo workspace. |
| `POST /workspaces/:workspaceId/contact-lists` | Cria lista com `name`. |
| `DELETE /workspaces/:workspaceId/contact-lists/:listId` | Exclui lista e preserva contatos. |
| `POST /workspaces/:workspaceId/contacts/:contactId/opt-out` | Registra supressão persistente; corpo `{}`. |

Todas exigem sessão e permissão; mutações exigem origem válida e `X-RCS-Request: 1`. O proxy só permite essas rotas/métodos e valida `offset`. Respostas usam `Cache-Control: no-store`.

A partir da migração 009, listas referenciadas por campanhas são preservadas. Sua exclusão retorna 409, inclusive quando a campanha está cancelada. Listas sem referência continuam sendo removidas sem apagar os contatos.

Aplicar migração 005 no ambiente antes de usar a tela. Os testes locais executam as migrações e a API real com PostgreSQL WASM/PGlite; não comprovam concorrência entre sessões PostgreSQL nativas nem fluxo visual no navegador. Edição individual, remoção individual de vínculos, busca e filtros de membros das listas podem ser estendidos posteriormente.

A migração 015 adiciona [registro de consentimento RCS](rcs-consents.md) por telefone e finalidade, via GET/POST em `/workspaces/:workspaceId/contacts/:contactId/rcs-consents`. Declarações/revogações possuem evidência referenciada, revisão esperada, telefone esperado e auditoria atômica; histórico não pode ser editado ou apagado. Importar um contato não cria consentimento e registrar granted não remove opt-out. A lista oferece o link Consentimento RCS por contato. O detalhe `/contacts/:contactId?workspace=…` mostra os resumos e, para gestores, formulário de declaração/revogação com data UTC e evidência explícitas. Leitores consultam sem gravar. Conflito ou resposta inconclusiva exige recarga antes de nova gravação; trocar workspace retorna à lista do workspace escolhido.
