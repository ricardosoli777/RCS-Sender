# Simulação persistida de campanhas — início da Wave 15

Esta é a fundação local de execução, agora com opção de processamento em segundo plano. Aplicar as migrações 010 e 011 após a 009. O modo explícito `simulation` congela destinatários e registra o processamento em PostgreSQL; não chama `RcsProvider`, nem o adaptador Mock, não lê credenciais e não faz envio externo. Resultados simulados não comprovam entrega, consentimento, elegibilidade RCS ou compatibilidade com fornecedores. O motor assíncrono de envio real permanece pendente.

## Preparação e processamento

O detalhe de campanha oferece **Preparar simulação local**, com confirmação e usando somente a configuração salva. Requer rascunho na revisão esperada, lista com pelo menos um contato sem opt-out, até 5.000 contatos no total e snapshot atualmente ativo da mensagem. Uma data configurada precisa estar no futuro durante a preparação. Conexão/agente reais não são necessários neste modo.

A preparação cria um único run imutável por campanha, fixa o UUID da versão de mensagem e copia os telefones normalizados da audiência. Opt-outs existentes são suprimidos. Alterações posteriores da lista, dos telefones originais ou da versão ativa não modificam o snapshot. Configuração fora de rascunho, identidade dos destinatários e resultados finais são protegidos no banco.

Cada acionamento processa até 50 pendentes. O opt-out é consultado novamente pelo telefone congelado; cada resultado simulado recebe ID determinístico por run/contato. Revisões esperadas rejeitam repetição de comandos antigos. Resultados, estado/revisão da campanha e auditoria são gravados na mesma transação, com rollback integral em falhas. Uma nova instância da API continua a partir do estado SQL.

A simulação usa os estados `ready`, `scheduled`, `running`, `paused`, `completed` e `cancelled`, identificados na interface pelo prefixo **Simulação**. Pausar preserva pendentes; retomar respeita a data; cancelar/parar finaliza apenas pendentes e preserva o histórico. Parada aqui é um controle local, sem operações externas em andamento.

A data estabelece `not_before`, validado pelo servidor. O usuário pode processar lotes manualmente ou solicitar **Executar simulação em segundo plano**. A solicitação automática exige o worker ativo, PostgreSQL e Redis; preparar a campanha não inicia automaticamente o processamento. Contagens são exibidas como simulados, suprimidos, cancelados e pendentes, sem apresentá-las como mensagens enviadas ou entregues.

## Outbox, fila e worker

A migração 011 cria uma outbox exclusiva da simulação. Solicitar processamento grava intenção, revisão e auditoria na mesma transação, mesmo que Redis esteja indisponível. Há no máximo uma intenção pendente por run. A API responde 202 com `automation`; isso confirma persistência da solicitação, sem afirmar que o worker está conectado.

O worker consulta até 20 intenções vencidas a cada dois segundos, sem sobrepor ciclos. Publica `campaign.simulation.batch` em `rcs-jobs` com somente ID de outbox, workspace e contador de tentativa. A data permanece em SQL; nenhum lote é executado antes dela. Cada lote bem-sucedido finaliza a intenção e cria a próxima na mesma transação se houver pendentes. O worker tem concorrência local 2; o bloqueio do workspace serializa suas operações atuais. Não é um controle de taxa de fornecedor.

IDs BullMQ determinísticos por outbox/tentativa reduzem publicações duplicadas. O SQL é a proteção definitiva: reentrega de uma tarefa já concluída não repete resultados. Jobs podem ser recriados após perda no Redis; retenção da fila é limitada a 1.000 concluídos e 1.000 falhos. Jobs falhos ainda pendentes em SQL são reativados pelo relay. Essa separação segue as orientações de [IDs de tarefa](https://docs.bullmq.io/guide/jobs/job-ids) e [operações idempotentes](https://docs.bullmq.io/patterns/idempotent-jobs) do BullMQ; remoção na fila não substitui idempotência persistida.

Antes de cada lote, o worker revalida o workspace, a conta e o papel de quem solicitou, o modo, estado e revisão da campanha. Revogação ou revisão obsoleta descarta a intenção. Pausar/cancelar/parar e processar um lote manual invalidam a solicitação automática. Retomar preserva os pendentes, mas exige solicitar novamente execução em segundo plano. Um lote já confirmado permanece no histórico; nenhuma mensagem externa está em andamento.

Falhas transacionais revertem lote, revisão, próximo job e auditoria. A outbox registra cinco tentativas no máximo, com esperas de 5/10/20/40 segundos entre as primeiras tentativas; a quinta falha deixa `dead`. Depois de corrigir a causa, um perfil autorizado pode solicitar novamente. Não existe interface de inspeção de DLQ ou retry de fornecedor. Falhas em que o banco não consegue sequer registrar a tentativa são tratadas como falhas de transporte pelo BullMQ, com três tentativas e backoff inicial de um segundo; a intenção SQL continua pendente para recuperação pelo relay. Não são armazenados textos de exceção ou dados pessoais no resumo.

A lógica SQL de lote é compartilhada em `@rcs/database` pela API e pelo worker. O worker fecha publicação em andamento, consumidor, fila, pool SQL e conexões Redis ao receber SIGINT/SIGTERM. Na interface, recarregar consulta o progresso; conflitos após avanço do worker exigem obter a revisão atual. O processamento manual interrompe a solicitação automática anterior.

## API

Todas as rotas usam `/workspaces/:workspaceId/campaigns/:campaignId/simulation`:

| Método e sufixo | Corpo / resultado |
| --- | --- |
| `GET` | `{ simulation: null }` antes da preparação, ou snapshot, contagens e `realSending: false`. |
| `POST /prepare` | `{ expectedRevision, mode: "simulation" }`; modo obrigatório, resposta 201. |
| `POST /step` | `{ expectedRevision }`; processa até 50 pendentes após a data. |
| `POST /enqueue` | `{ expectedRevision, mode: "simulation" }`; persiste execução automática, resposta 202. |
| `POST /control` | `{ expectedRevision, action }`; `pause`, `resume`, `cancel` ou `stop`. |

Leitura exige `campaigns.view`; mutações exigem `campaigns.send` (owner/admin/operator), sessão e proteção CSRF. Conta, workspace e vínculo ativo são revalidados na transação. Chaves compostas e filtros isolam workspaces. Resumos e auditoria não retornam telefones ou conteúdo de mensagem; o snapshot interno contém os telefones necessários ao processamento. Não há endpoint de execução real neste módulo.

## Validação e próximos componentes

Em 03/10/2026, build, tipos dos pacotes/E2E, lint e **186 testes locais** passaram; seis testes externos foram pulados. Onze novos testes SQL/HTTP/modelo/proxy cobrem congelamento, lotes, revisões repetidas, opt-out do telefone congelado, controles/data, continuação entre instâncias, limites, isolamento, revogação e rollback de auditoria. A migração foi executada em PostgreSQL WASM/PGlite; as chamadas concorrentes do teste compartilham uma conexão serializada e não validam concorrência entre sessões nativas.

O cenário Playwright de campanhas foi ampliado e passou em tipos/descoberta, sem execução em navegador. Não houve nova CI, envio externo ou validação com PostgreSQL/Redis nativos nesta etapa.

Após a extensão assíncrona, 198 testes locais passaram entre a execução geral e a repetição completa da API, além de build, tipos e lint. Oito novos testes SQL/HTTP verificam cadeia automática de lotes, reentrega, data, opt-out, pausa/retomada/parada, intervenção manual, revogação, revisão obsoleta, rollback e retries/estado `dead`. Quatro testes de relay verificam IDs, falha Redis, retomada de jobs e validação do payload; o teste de proxy inclui a nova rota. Duas falhas de assertions foram corrigidas: o teste anônimo agora envia cabeçalhos CSRF válidos para alcançar a autenticação, e a verificação de privacidade compara telefones completos para não confundir um trecho de UUID aleatório com telefone. As migrações até 011 executaram em PGlite. Redis/BullMQ real e concorrência entre sessões PostgreSQL nativas não foram executados; o transporte foi verificado com doubles. Seis testes externos permanecem pulados. Não houve nova CI ou E2E no navegador nesta extensão.

Etapas posteriores adicionaram preflight do cache, núcleo interno de despacho e [preparação/confirmação com audiência congelada](campaign-dispatch-preparation.md), agora integrada a API/interface e cancelamento antes de tentativas. Ainda faltam consentimento, worker de despacho e agendamento de envio real, estratégia de elegibilidade por fornecedor, publicação de mídia, retries/backoff/DLQ de operações externas, tracking e tratamento de envios em andamento. Event bus e runtime de Jornadas seguem nas waves posteriores. Credenciais e prova com fornecedores serão usadas posteriormente, conforme a orientação do projeto. Campanhas simuladas não são convertidas em envio real; esta wave ainda não está completa.
