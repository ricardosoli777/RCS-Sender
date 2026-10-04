# Outbox interna de despacho

A migração 016 e `CampaignDispatchOutbox` persistem intenções por destinatário de um run confirmado. O pacote compartilhado `@rcs/dispatch` fornece o núcleo, a outbox e o bootstrap usados pela API e pelo worker. O relay e o consumidor `campaign.dispatch.recipient` estão registrados no worker; consulta e enfileiramento estão integrados à API, ao proxy e à interface. **O registro padrão inclui cinco adaptadores inativos: não há despacho externo disponível por padrão.**

## Persistência e recuperação

`enqueue` exige workspace e solicitante ativos com perfil owner/admin/operator, campanha ready no modo dispatch, revisão exata, run confirmado, ausência de fila anterior para esse run e ausência de qualquer tentativa na campanha. Somente destinatários originalmente elegíveis entram na fila. Inserção, incremento da revisão e auditoria são atômicos. A data mínima do run define quando os jobs ficam disponíveis; o dispatcher revalida consentimento, telefone, elegibilidade e configuração ao executar.

O polling retorna até 20 jobs vencidos, incluindo leases expirados. Cada payload contém somente ID da outbox, workspace e geração de tentativas. O claim serializa workspace, campanha e outbox, valida geração e autorização atual e adquire lease de 30 segundos. O núcleo limita sua operação a dez segundos; não há heartbeat do lease.

| Estado | Significado |
| --- | --- |
| pending | Aguardando data ou nova tentativa sem ledger. |
| processing | Claim persistido com token e lease. |
| completed | Ledger accepted ou rejected; não comprova entrega. |
| unresolved | Ledger sending ou unknown; requer reconciliação futura. |
| discarded | Revisão/autorização inválida, bloqueio do núcleo ou cancelamento. |
| dead | Cinco claims sem tentativa registrada no ledger. |

Antes de chamar o núcleo e após seu retorno, o ledger decide o resultado. Se uma tentativa já existe, a outbox apenas registra seu estado, sem novo envio. Falha na auditoria de finalização deixa processing; após o lease, a recuperação consulta o ledger novamente. Token antigo não pode finalizar um claim substituído. Identidade e estados terminais são imutáveis no banco.

Somente falha sem ledger permite repetição, com intervalos de 5, 10, 20 e 40 segundos e limite de cinco claims. Essa garantia depende do contrato do núcleo: a reserva do ledger sempre precede a chamada externa. Não são retries de fornecedor. Falhas de consentimento, telefone ou elegibilidade descartam o job; não há promoção automática de destinatários. Cancelar a preparação descarta jobs pending/processing na mesma transação, somente antes de qualquer tentativa no ledger.

## Relay e consumidor

`apps/worker/src/dispatch-relay.ts` publica `campaign.dispatch.recipient` com chave estável por ID/geração. Jobs ativos são preservados; jobs falhos são recuperados; um job BullMQ concluído cuja intenção SQL continua vencida pode ser recriado. O transporte usa uma tentativa BullMQ: orçamento e recuperação pertencem ao SQL. O relay e seu parser não recebem telefone, conteúdo ou credenciais.

Ainda faltam configuração dos adaptadores no bootstrap de produção, estratégia documentada de elegibilidade por fornecedor, limites por fornecedor, protocolo de controles em andamento, reconciliação e tracking. O estado agregado de conclusão da campanha não é atualizado por esta fundação. A data e o polling estão ligados ao worker, mas o transporte precisa de validação com PostgreSQL/Redis nativos. Não houve chamada externa.

## Validação local

Em 04/10/2026, 314 testes locais, build, tipos dos pacotes/E2E e lint passaram. A integração acrescenta dez casos SQL/runtime/HTTP, quatro de interface/proxy e três do roteador do worker. O pacote usa testes SQL do módulo de campanhas para exercitar a mesma implementação consumida por ambos os processos. Seis testes externos foram pulados; não houve CI, navegador, transporte nativo ou fornecedor real.

## API e interface

Base: `/workspaces/:workspaceId/campaigns/:campaignId/dispatch`.

- `GET`: resumo `{ dispatch: { campaignId, revision, runId, executionAvailable, counts } }` sem dados dos destinatários. Exige sessão e `campaigns.view`.
- `POST /enqueue`: `{ mode: 'dispatch', expectedRevision, runId }`, corpo estrito de até 1 KiB; exige sessão, CSRF e `campaigns.send`. Retorna 201 com run, nova revisão e quantidade enfileirada. Não chama o fornecedor na requisição.

Disponibilidade exige chaves de descriptografia e adaptador ativo com texto e elegibilidade suportados. Resumo também exige preparação confirmada, campanha ready no modo dispatch e conexão connected. Não comprova consentimento ou elegibilidade de todos os destinatários: o núcleo revalida ao executar. O registro padrão continua vazio, tanto na API quanto no worker.

O painel mostra contagens por estado. Leitores consultam; gestores de envio podem enfileirar uma preparação confirmada sem fila anterior, com confirmação explícita. Após falha/conflito/timeout, as alterações ficam bloqueadas até recarga. Preparar e confirmar continuam operações separadas do enqueue. A operação de cancelamento permanece limitada a antes de qualquer tentativa no ledger.

Shutdown aborta operações em andamento. Um sinal já interrompido não adquire claim; se não houve ledger, a intenção permanece recuperável com backoff. Se houve ledger, o resultado persistido continua sendo a fonte de recuperação. Indisponibilidade global do runtime não adquire claims nem publica jobs; uma falha do relay de despacho não bloqueia o relay de simulação.

Treze novos casos SQL exercitam enqueue, data, isolamento/geração, revogação de perfil/conta, revisão, consentimento, telefone, cancelamento, recuperação após falha de auditoria, resultados incertos, esgotamento e rollback. Dois testes do relay verificam payloads e reentrega com doubles. As migrações são exercitadas em PGlite com conexão serializada; isso não prova concorrência entre sessões PostgreSQL nativas. Não houve chamada real a fornecedor, execução Redis/BullMQ nativa ou ativação do despacho.
# Controles e cadenciamento de despacho

A fila de despacho agora tem pausa, retomada e parada na API e na interface. Os controles exigem a revisão atual, permissão de envio e auditoria atômica. Destinatários sem ledger recebem a nova revisão da campanha e têm leases invalidados; destinatários com tentativa reservada mantêm seu histórico e não podem ser reenviados. Uma consulta ao agente que termina depois da pausa precisa passar novamente pela verificação antes de `send`.

O agendador compartilha uma janela persistida por conexão entre campanhas e jornadas. O intervalo local padrão é de 1.000 ms entre reservas de despacho. A espera não consome tentativas de falha e não cria ledger externo. Esse cadenciamento limita despachos; limites individuais de chamadas da API do fornecedor ainda precisam de integração específica. Campanhas com todas as tarefas finalizadas passam a concluídas, ou falhas quando houver resultados incertos/falhas definitivas. Concluída não comprova entrega.

Migrações 026 e 027; testes locais cobrem controles, acesso atual, revisão, rollback de auditoria, pausa durante consulta, cadenciamento entre campanhas e finalização.
