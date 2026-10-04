# Núcleo interno de despacho — Wave 15

`CampaignDispatch` é a implementação interna de despacho por destinatário, com ledger SQL persistente. Aplicar as migrações 013 e 014 depois da 012. O núcleo está no pacote compartilhado `@rcs/dispatch`, ligado ao consumidor do worker e à [outbox com comando de enqueue](campaign-dispatch-outbox.md). O registro padrão inclui cinco adaptadores inativos, portanto a execução externa permanece indisponível por padrão. Testes usam um adaptador fixture com métodos simulados, credenciais sintéticas criptografadas e PostgreSQL WASM/PGlite. Nenhuma API de fornecedor foi chamada nesta etapa.

A migração 013 admite o modo `dispatch`, além de `simulation`, e cria `campaign_dispatch_attempts`. A migração 014 acrescenta runs, audiência congelada e confirmação imutáveis. Os testes agora usam `CampaignDispatchPreparation` em vez de bootstrap SQL. A [preparação e confirmação](campaign-dispatch-preparation.md) estão integradas à API/proxy/interface, com cancelamento antes de qualquer tentativa. A migração 015 acrescenta declaração de consentimento por telefone/finalidade, exigida nos checkpoints. A migração 016 e o runtime compartilhado ligam a fila ao worker. Captura/verificação automática da evidência e configuração dos fornecedores continuam pendentes. Disponibilidade de execução é consultada separadamente da preparação e depende do runtime configurado.

## Fluxo interno

1. Revalidar conta, workspace e papel owner/admin/operator na transação. Localizar a campanha nesse workspace.
2. Se já existe tentativa para campanha/contato, retornar seu resumo e não executar chamadas do adaptador. Há uma única tentativa persistida por workspace/campanha/contato.
3. Para uma tentativa nova, exigir modo `dispatch`, estado ready/queued/running, revisão esperada, data já alcançada e run confirmado cuja configuração corresponde à campanha. `simulation` e campanhas sem snapshot confirmado são recusados.
4. Verificar conexão conectada, agente vinculado correspondente, adaptador ativo, capacidade de texto/elegibilidade e check positivo válido para telefone e versão de credenciais atuais, sem opt-out. O contato precisa estar congelado como elegível no run; novos membros da lista e destinatários inicialmente suprimidos ou indisponíveis não são promovidos. Mudança do telefone original bloqueia o despacho. Remover um membro da lista não altera o run; opt-out continua sendo revalidado. A última declaração de [consentimento](rcs-consents.md) para o telefone e a finalidade da mensagem precisa ser granted; ausência, revogação ou outra finalidade bloqueiam a reserva.
5. Carregar o snapshot ativo da mensagem e validar formato, sugestões, assets e limites do fornecedor. Texto, rich card, carrossel e imagem dependem do suporte declarado; file/PDF não suportado permanece bloqueado.
6. Descriptografar credenciais com o mesmo contexto autenticado do Provider Core e validá-las no adaptador. Divergência da identidade externa do agente bloqueia a reserva.
7. Persistir `sending` e auditoria atomicamente, fixando telefone, snapshot de mensagem, conexão, agente, solicitante, revisão e fingerprint de credenciais. Sem commit dessa reserva não há chamada de fornecedor.
8. Consultar agente e capacidades do agente pelo contrato do adaptador. Revalidar novamente conta/papel, estado/revisão/data, telefone, opt-out, consentimento da finalidade, elegibilidade, mensagem ativa e versão da conexão/credenciais em SQL antes de invocar `send`.
9. Invocar `send` com chave estável `dispatch-<UUID da tentativa>`. Registrar resultado e auditoria em outra transação.

As operações do adaptador e a última checagem têm um prazo local conjunto de dez segundos após a reserva. Interrupção vence mesmo se o adaptador ignorar o sinal. Reserva e gravação final SQL não são abrangidas por esse prazo. Resultados posteriores ao prazo não substituem o resultado persistido.

## Resultados e recuperação

| Estado | Significado |
| --- | --- |
| `sending` | Reserva confirmada, sem resultado final persistido. Pode existir mesmo sem chamada efetiva a `send`. |
| `accepted` | Adaptador retornou aceitação e ID opaco validado. Não significa entrega ou leitura. |
| `rejected` | Rejeição canônica ou validação final impediu o envio. Não é automaticamente repetida. |
| `unknown` | Exceção, cancelamento, timeout, resposta inconclusiva ou ID inválido; aceitação externa pode ser desconhecida. |

Nenhum desses estados habilita reenvio automático, mesmo quando o adaptador retorna `retryable: true`. Uma reentrega encontra o ledger e não chama o adaptador novamente. `unavailable` e `unknown` são inconclusivos; `rate_limited`, `rejected`, credenciais/mensagem inválidas e capacidade não suportada são registrados como rejeição. O formato inicial do ID aceito é `[A-Za-z0-9._~-]{1,256}`, uma política local para IDs opacos, sem aceitar nomes de recursos ou respostas brutas.

Falha na auditoria da reserva desfaz o ledger e impede a chamada. Falha na gravação/auditoria do resultado preserva `sending`: o fornecedor pode já ter aceitado, e uma nova execução não o reenviará. O núcleo tenta registrar o resultado de uma operação já iniciada mesmo se a conta/papel ou campanha mudar durante a chamada. Isso registra o que aconteceu; não autoriza uma chamada nova após revogação.

Identidade da tentativa e resultados finais são protegidos por trigger. Não há exclusão ou reset. Callbacks autenticados acrescentam evidência remota sem reescrever o resultado original; Google pode reservar identidade remota na mesma transação do ledger antes do POST. O resumo mantém aceite, entrega/leitura e evidência de tentativa incerta separados. Auditoria não registra telefone, conteúdo, credenciais ou respostas brutas.

## Limites de integração

SQL e fornecedor não compartilham transação. Pausa/parada bloqueiam novas reservas; uma chamada já iniciada pode terminar e seu resultado é registrado. Orçamento compartilhado e callbacks autenticados controlam taxa e acompanhamento; não existe reenvio automático de operação ambígua. A evidência de consentimento é declarada pelo operador, sem captura/verificação externa automática. Cancelar preparação só é permitido antes de qualquer tentativa. O núcleo usa a audiência congelada e não admite novos membros da lista no run existente.

Ele depende de check de elegibilidade suportado e válido. Google/Infobip têm consulta síncrona e Sinch assíncrona; Twilio/Zenvia continuam desconhecidos. Fornecedores ficam desativados até configuração posterior das contas, sem bloquear construção e testes locais.

## Validação atual

A bateria final passou com 442 testes, nove verificações de domínio em PostgreSQL nativo e sete cenários Chromium. Inclui isolamento, revisões, consentimento, snapshot, reserva multiprocesso, resultado incerto sem reenvio, callbacks e controles. Consulte [validação](validation.md) para evidências e limites.

Contas, agentes lançados, envio RCS real e deployment de VPS ficam para configuração posterior. Declarações locais não atestam a evidência de consentimento nem entrega real.
