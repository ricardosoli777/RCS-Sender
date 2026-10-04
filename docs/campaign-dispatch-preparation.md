# Preparação de despacho — Wave 15

A migração 016 acrescenta a [outbox interna](campaign-dispatch-outbox.md). O cancelamento da preparação descarta seus jobs pending/processing atomicamente, mantendo a condição de não existir qualquer tentativa no ledger. A confirmação pela interface continua sem criar ou executar jobs.

`CampaignDispatchPreparation` constrói e confirma um run de despacho usando somente SQL e metadados do registro de adaptadores. Não consulta agente, capacidades externas ou APIs de fornecedores, não descriptografa credenciais, não cria jobs e não envia mensagens. Está integrado à API, ao proxy e ao detalhe da campanha; o dispatcher de envio está no pacote compartilhado e ligado ao consumidor do worker. O resumo da preparação conserva `executionAvailable: false`: confirmar não executa jobs. A consulta separada de despacho informa a disponibilidade do runtime. Aplicar a migração 014 depois da 013.

## Preparação

`prepare(context, campaignId, expectedRevision)` exige workspace e conta ativos, papel owner/admin/operator, campanha em rascunho, modo ainda não escolhido e revisão atual. A configuração precisa conter conexão conectada com credenciais salvas, agente correspondente, mensagem de texto simples ativa sem sugestões e lista de até 5.000 contatos. O adaptador precisa estar ativo e declarar suporte a texto e elegibilidade. Uma data configurada precisa estar no futuro.

A operação congela todos os contatos presentes em uma única leitura da lista, com telefone normalizado e classificação exclusiva:

| Classificação | Condição na preparação |
| --- | --- |
| `suppressed` | Opt-out para o telefone, com prioridade sobre qualquer check. |
| `eligible` | Check positivo do fornecedor, ainda válido, para o telefone e fingerprint da conexão/credenciais. |
| `unavailable` | Qualquer outra situação, incluindo ausência de check, check negativo, desconhecido, expirado ou divergente. |

É necessário pelo menos um destinatário elegível. O run fixa conexão, agente, versão da mensagem, lista, fingerprint, data e solicitante. Run, destinatários, revisão e auditoria são persistidos atomicamente; falha desfaz tudo. A campanha passa a `ready`, modo `dispatch`, com revisão incrementada. Nesse contrato interno, `ready` identifica preparação salva e não execução autorizada ou iniciada. A data fica em `not_before`; preparar não agenda transporte.

Depois da preparação, a configuração da campanha e o snapshot são imutáveis. Contatos adicionados à lista não entram no run; removidos permanecem congelados. Opt-out é a forma de bloquear um telefone já congelado e é revalidado antes de cada despacho. Telefones alterados bloqueiam o destinatário; o núcleo não envia ao telefone novo nem reaproveita automaticamente a autorização do original. Contatos inicialmente suprimidos ou indisponíveis não são promovidos, mesmo que seu cache mude.

## Confirmação

`confirm(context, campaignId, expectedRevision, runId, 'dispatch')` exige novamente autorização atual, revisão exata da preparação e identidade completa da configuração congelada. Conexão/fingerprint e mensagem ativa precisam continuar válidos. Deve existir ao menos um destinatário originalmente elegível cujo telefone, check e opt-out ainda permitam despacho. A confirmação não renova checks nem promete elegibilidade dos demais contatos; o núcleo revalida cada destinatário.

A confirmação grava solicitante, run, revisão e data em registro separado imutável, com auditoria e incremento de revisão na mesma transação. Repetição ou confirmação de outro run/modo/revisão falha sem criar jobs. A confirmação representa a aprovação do snapshot pelo solicitante; **não registra consentimento do lead**. A [API de consentimento](rcs-consents.md) registra declarações separadas, que o dispatcher verifica por telefone/finalidade. Captura automática e verificação da evidência continuam pendentes. O comando separado de enqueue está na [fila de despacho](campaign-dispatch-outbox.md).

`CampaignDispatch` exige esse run confirmado para novas tentativas. A migração também recusa inserção de ledger que não corresponda a um destinatário elegível de um snapshot confirmado. Tentativas históricas da migração 013 permanecem preservadas; nenhum snapshot ou consentimento fictício é criado para elas. Uma tentativa já existente continua retornando seu resultado sem reenvio, conforme o contrato do ledger.

O resumo retorna IDs, revisão, estado da campanha, confirmação e contagens; não expõe telefone, fingerprint, conteúdo ou credenciais. Logs de auditoria contêm run, revisão, modo ou tamanho da audiência. Os telefones necessários à execução permanecem nas tabelas internas do workspace.

## API e interface

Base: `/workspaces/:workspaceId/campaigns/:campaignId/dispatch-preparation`.

| Método e rota | Corpo / resposta |
| --- | --- |
| `GET` | `{ preparation: null }` antes da preparação, ou resumo salvo com `executionAvailable: false`. |
| `POST /prepare` | `{ expectedRevision, mode: 'dispatch' }`; 201 com resumo. |
| `POST /confirm` | `{ expectedRevision, mode: 'dispatch', runId }`; 200 com resumo. |
| `POST /cancel` | `{ expectedRevision, mode: 'dispatch', runId }`; 200 com resumo cancelado. |

Consulta exige `campaigns.view`; alterações exigem `campaigns.send`, sessão, origem e cabeçalho CSRF válidos. Os corpos são estritos, limitados a 1 KiB na API; revisão é inteiro positivo e IDs usam UUID. O proxy permite somente essas operações, limita o corpo a 8 KiB e não expõe send/enqueue/step/control de despacho. Respostas não são armazenadas em cache.

O painel usa a configuração salva e exige confirmação explícita antes de cada alteração. Exibe contagens do snapshot, não o total atual da lista. Falha de leitura ou revisão divergente bloqueia ações; revisão inicial de uma campanha sem configuração ou check positivo bloqueia preparação. O servidor revalida todas as condições, inclusive texto simples. Leitores veem os resumos sem botões de alteração. Campanhas simuladas exibem seu painel próprio; campanhas com modo dispatch exibem preparação em vez de controles de simulação. O estado ready é apresentado como **Preparação de despacho**, sem sugerir que o envio começou.

Cancelar uma preparação exige run/revisão corretos, estado ready e **nenhuma tentativa de despacho persistida**, incluindo sending, accepted, rejected ou unknown. A operação muda a campanha para cancelled, incrementa revisão e audita atomicamente. Run, destinatários e confirmação permanecem no histórico. Falha de auditoria desfaz o cancelamento. Após cancelar, não é possível confirmar ou editar esse run; uma nova campanha poderá usar outra configuração. Isso não implementa parada de envios em andamento nem controles de jobs reais.

## Validação atual

A bateria final passou com 442 testes, nove verificações de domínio em PostgreSQL nativo e sete cenários Chromium. Inclui isolamento, revisões, consentimento, snapshot, reserva multiprocesso, resultado incerto sem reenvio, callbacks e controles. Consulte [validação](validation.md) para evidências e limites.

Contas, agentes lançados, envio RCS real e deployment de VPS ficam para configuração posterior. Declarações locais não atestam a evidência de consentimento nem entrega real.
