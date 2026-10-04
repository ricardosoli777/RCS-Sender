# Domínio de campanhas — Wave 14

Núcleo e interface inicial implementados localmente, com rascunhos por workspace, revisões otimistas, referências a conexão/agente/lista/versão de mensagem, data configurável, cancelamento de rascunhos e revisão local. Aplicar a migração 009 antes de usar. Fila/agendamento de envio real, tracking e controles de operações externas permanecem pendentes. A Wave 15 adiciona [simulação persistida](campaign-simulation.md), com preparação, lotes manuais ou execução em segundo plano e controles locais; requer também as migrações 010 e 011.

## Interface de rascunhos

`/campaigns?workspace=…` lista até 50 campanhas por página, com filtro de estado, revisão e data identificada em UTC. Proprietários, administradores e operadores criam/alteram rascunhos; leitores apenas consultam. Falhas de leitura são apresentadas como indisponibilidade, sem simular listas vazias.

`/campaigns/:id?workspace=…` mostra configuração salva e revisão local, com totais da audiência, opt-outs, pendências em português e link para o snapshot de mensagem vinculado. A revisão representa os dados salvos, não as alterações ainda preenchidas no formulário. Cancelamento exige confirmação na interface e a revisão atual; após cancelar, o formulário desaparece.

Os seletores consultam conexões, listas e versões ativas em páginas de 50 opções. Conexões expõem somente ID/nome/estado/agente vinculado; nenhuma credencial é enviada. O agente vinculado é preenchido ao selecionar a conexão e pode ser informado manualmente. Isso não equivale a consulta real de agentes.

Referências já vinculadas são preservadas mesmo fora da página atual, diante de erro de carregamento ou quando o snapshot deixa de ser ativo. Trocar uma seleção ou removê-la exige ação explícita. A edição mantém também os segundos/milissegundos da data original enquanto o usuário não altera o campo. Datas editadas usam resolução de minutos em UTC, com validação de calendário e futuro. Não existe conversão automática de fuso nem criação de job de envio.

Trocar workspace em um detalhe volta à listagem do novo workspace, removendo paginação e consulta de versão. Campos preenchidos permanecem diante de conflitos de revisão; após salvar, o formulário fica bloqueado até a atualização para evitar repetir a gravação.

Sete novos testes de modelo/proxy/SQL verificam preservação de referências/data, UTC, drafts parciais, mensagens de revisão, catálogo mínimo, isolamento, paginação, perfil operador e revogação para leitor. A execução completa passou com 175 testes locais, build, tipos e lint. O cenário `e2e/campaigns.spec.ts` foi preparado e descoberto, mas não executado; não houve inspeção visual em navegador ou nova CI.

| Rota | Operação |
| --- | --- |
| `POST /workspaces/:workspaceId/campaigns` | Cria rascunho com nome e objetivo. Referências e data são opcionais. |
| `GET /workspaces/:workspaceId/campaigns?offset=0&status=draft` | Lista até 50 campanhas por página com total e filtro opcional de estado. |
| `GET /workspaces/:workspaceId/campaigns/:campaignId` | Consulta a configuração e a revisão atuais. |
| `PUT /workspaces/:workspaceId/campaigns/:campaignId` | Substitui a configuração completa; exige `expectedRevision`. |
| `POST /workspaces/:workspaceId/campaigns/:campaignId/cancel` | Cancela somente rascunho, com `expectedRevision`. |
| `GET /workspaces/:workspaceId/campaigns/:campaignId/review` | Diagnóstico local da configuração e audiência, sem mudar estado. |
| `GET /workspaces/:workspaceId/campaigns/options?kind=messages&offset=0` | Até 50 opções e total; `kind` aceita `connections`, `audiences` ou `messages`. Exige gestão de campanhas. |

## Configuração

`name` aceita até 100 caracteres e `objective` até 500, sem controles. `providerConnectionId`, `audienceListId` e `messageVersionId` são UUIDs opcionais do mesmo workspace; `agentId` aceita até 128 caracteres. `messageVersionId` é o UUID de um snapshot, não o UUID da mensagem ou o número da revisão. Os campos ausentes são normalizados como nulos. No PUT, omitir um campo opcional remove sua seleção: a operação é substituição completa, não edição parcial.

`scheduledAt` aceita uma data futura em UTC canônico, por exemplo `2026-10-04T12:00:00.000Z`. Salvar essa data mantém a campanha em `draft`; não cria um agendamento executável. Datas que expirarem são apontadas pela revisão local.

A revisão começa em 1 e avança nas edições e no cancelamento. Uma revisão desatualizada retorna 409. Campanhas canceladas não podem ser editadas ou reativadas pela API. A migração reserva os nove estados do spec e impede alterar a configuração de campanhas fora de rascunho. As rotas de rascunho produzem `draft` e `cancelled`; a simulação também produz estados de execução, identificados por `execution_mode=simulation`.

## Referências e revisão local

As chaves compostas impedem referências entre workspaces. A versão de mensagem permanece fixada: editar ou ativar uma nova revisão na biblioteca não altera a campanha automaticamente. O diagnóstico aponta quando o snapshot escolhido já não é a versão ativa; o operador precisa editar o rascunho para selecionar outra versão, se necessário.

Listas referenciadas são preservadas, inclusive em campanhas canceladas. Excluir uma lista em uso retorna 409 na API de contatos. A composição da lista é dinâmica; importações e opt-outs podem alterar os totais da revisão local. A preparação da simulação congela seus próprios destinatários. A preparação de despacho também congela sua audiência e exige confirmação separada, agora na API e no detalhe da campanha. O painel mostra contagens congeladas, permite cancelamento antes de qualquer tentativa e informa que confirmar não envia mensagens. Consentimento, worker e comando de envio real permanecem pendentes. Veja [preparação de despacho](campaign-dispatch-preparation.md).

A revisão devolve `audience.total`, `optedOut` e `remaining`. `remaining` significa apenas contatos sem opt-out registrado; não comprova consentimento, elegibilidade RCS nem autorização para envio. O diagnóstico identifica campos ausentes, audiência vazia/totalmente bloqueada, conexão não verificada, divergência de agente vinculado, adaptador inativo, versão não ativa, limites/capacidades declarados e data expirada.

A revisão local mantém `executionAvailable: false`: ela não autoriza envio nem substitui preparação, confirmação e disponibilidade do runtime, consultadas separadamente. Usa estado salvo, capacidades e checks de elegibilidade, sem chamadas externas ou exposição de credenciais. A simulação é uma operação separada. O dispatcher revalida agente/destinatário, consentimento e configuração antes da chamada real.

A revisão inclui `eligibility.source`, `checkedAt` e contagens exclusivas de elegíveis, não elegíveis, bloqueados, desconhecidos, consultas inválidas/expiradas e ausentes. Resultados são associados ao telefone consultado pela migração 012. A interface também aponta mídia privada ainda sem publicação. Veja [preflight local e seus limites](campaign-preflight.md).

Leitura usa `campaigns.view` para todos os perfis com vínculo ativo. Escrita usa `campaigns.manage` para proprietário, administrador e operador. Mutações exigem sessão, origem válida e `X-RCS-Request: 1`; o repositório revalida conta/workspace/vínculo na transação. Configuração e auditoria são atômicas. O log registra revisão/estado, sem objetivo ou conteúdo da mensagem.

Onze testes novos de validação/SQL/HTTP e um de proxy cobrem isolamento, snapshot fixado, supressão, conflitos, configuração congelada, lista em uso, permissões, paginação e rollback. A execução completa passou com 168 testes locais; após o ajuste de exclusão de lista, os 21 testes de campanhas/contatos passaram novamente. SQL executou em PostgreSQL WASM/PGlite, sem concorrência entre sessões nativas, nova CI, E2E no navegador ou envio externo.
