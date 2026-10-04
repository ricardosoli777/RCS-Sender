# Eligibility Engine — Wave 9

Núcleo inicial implementado localmente para a especificação 6.0.0. Uma consulta relaciona contato, conexão e workspace; ela não representa consentimento, autorização para enviar ou capacidade de outro provedor. A implementação não exige conta real para construir o app.

`POST /workspaces/:workspaceId/providers/:connectionId/eligibility` recebe somente `{ "contactId": "UUID" }`. Sessão, origem válida, `X-RCS-Request: 1` e `providers.manage` são obrigatórios. A ferramenta administrativa inicial atende proprietários e administradores; operadores e leitores não acessam credenciais ou executam essa consulta pela API. O futuro preflight/worker precisará de seu próprio contexto de execução autorizado.

| Estado | Significado |
| --- | --- |
| `eligible` | A operação verificada `checkEligibility` retornou `true`. |
| `ineligible` | A mesma operação retornou `false`. |
| `unknown` | Capacidade ausente/desconhecida, conexão indisponível, falha, timeout ou consulta ainda em execução. |
| `blocked` | Opt-out persistente no workspace. |

Somente adaptador ativo com capacidade `eligibility: supported` e método implementado é consultado. Google e Infobip têm consulta síncrona; Sinch inicia consulta assíncrona. Twilio/Zenvia mantêm suporte desconhecido. Credenciais e agente são validados antes da operação. `null` mantém o estado desconhecido; formato do telefone ou envio de teste nunca comprovam suporte.

A operação tem prazo local de oito segundos, inclusive para adaptador que ignore cancelamento. Cancelar a requisição não finaliza o resultado. Nenhum retorno contém telefone, credencial, ciphertext, versão interna ou resposta bruta de fornecedor.

A migração 006 cria `eligibility_checks` com chaves estrangeiras compostas para contato e conexão. Cada tentativa reserva um ID interno e substitui o resultado anterior por `unknown/checking`; somente a última tentativa pode finalizar uma vez. Rotação de credenciais ou mudança na revisão da conexão invalida a resposta anterior. A gravação revalida conta, workspace e perfil, além de reconsultar opt-out e estado da conexão. Opt-out prevalece sobre resposta positiva do fornecedor.

O prazo de validade local de cinco minutos é uma política inicial do app, não uma garantia ou quota do fornecedor. `checkedAt` e `expiresAt` são retornados na resposta. Não há endpoint de leitura ou reutilização automática de cache nesta etapa; o POST sempre inicia uma tentativa. Futuros consumidores deverão rejeitar resultados expirados, revisar a versão da conexão e revalidar opt-out imediatamente antes do envio.

A Wave 15 acrescenta leitura agregada de checks salvos na revisão de campanhas, sem iniciar consultas ou aprovar envios. Aplicar migração 012: cada reserva registra o telefone consultado e rejeita divergência do telefone esperado; alterações durante a chamada produzem `unknown/contact_changed`, salvo opt-out atual, que prevalece. Resultados antigos sem telefone conhecido não são preenchidos retroativamente e ficam inválidos para essa leitura até nova consulta. Veja [preflight local](campaign-preflight.md).

Reserva e finalização geram auditoria atômica (`eligibility.requested` e `eligibility.checked`), com IDs e estados, sem telefones ou credenciais. Falha de auditoria desfaz a alteração. Uma requisição abandonada pode deixar uma reserva desconhecida, que nunca aprova envio.

Sinch grava o requestId e mantém unknown/checking até callback autenticado. A atualização exige tentativa mais recente, validade, credenciais, telefone e solicitante ativo com perfil atual de owner/admin; opt-out prevalece. Callback atrasado, substituído ou de outro telefone não aprova envio. Migração 029 registra o solicitante. Campanhas e jornadas rejeitam cache vencido ou configuração divergente antes do despacho. Testes locais incluem essa atualização em PostgreSQL nativo; uso externo permanece para depois, conforme [validação](validation.md).
