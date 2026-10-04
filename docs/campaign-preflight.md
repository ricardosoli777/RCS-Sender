# Preflight local de campanhas — Wave 15

A revisão `GET /workspaces/:workspaceId/campaigns/:campaignId/review` agora inclui um diagnóstico agregado do cache de elegibilidade. A interface de detalhe mostra esse diagnóstico junto à configuração salva. Não consulta APIs, não descriptografa credenciais, não modifica a campanha e não inicia processamento. `executionAvailable` permanece `false`: este é um componente do preflight, ainda sem confirmação ou despacho de envio real.

## Contrato de leitura

`eligibility` contém `source: "saved_checks"`, `checkedAt` (horário da revisão local) e `counts`. Esse horário não é o horário de uma consulta nova ao fornecedor. As categorias são exclusivas e somam `total`:

| Categoria | Significado |
| --- | --- |
| `blocked` | Opt-out atual ou resultado bloqueado ainda válido no cache. O opt-out atual prevalece mesmo sobre cache vencido ou ausente. |
| `unchecked` | Não há consulta salva para esse contato na conexão selecionada. |
| `stale` | Expirou, o telefone mudou, o telefone consultado é desconhecido, a versão da conexão/credenciais diverge, ou a conexão está indisponível/sem credenciais. |
| `unknown` | Resultado desconhecido/em andamento, combinação inconclusiva ou capacidade de elegibilidade sem suporte confirmado no adaptador ativo. |
| `eligible` | Resultado positivo `provider_checked`, válido para telefone/conexão atuais e adaptador ativo com capacidade de elegibilidade suportada. |
| `ineligible` | Resultado negativo `provider_checked` sob as mesmas verificações. |

A leitura usa apenas a lista, conexão e checks do workspace selecionado. Para comparar a versão de conexão, calcula uma impressão interna do ciphertext e da revisão SQL da conexão. Não retorna ciphertext, impressão, telefones, IDs de tentativas ou conteúdo das mensagens. Não descriptografa nem valida os valores das credenciais. Leitores podem consultar a revisão com `campaigns.view`; somente owner/admin continuam podendo iniciar a consulta administrativa de elegibilidade com `providers.manage`.

O diagnóstico aponta checks ausentes, inválidos, desconhecidos e negativos, além de ausência de elegíveis válidos. Também sinaliza falta de credenciais, agente não vinculado e mídia privada sem publicação para o fornecedor. Capacidades e limites do adaptador continuam sendo comparados ao snapshot da mensagem. Um agente sem vínculo é uma pendência de configuração; a contagem de elegibilidade do destinatário não representa validação desse agente.

Elegibilidade salva não comprova consentimento, entrega, disponibilidade atual do agente ou suporte a todos os recursos da mensagem no destinatário. A validade de cinco minutos é política local do app. Quando houver despacho real, ele deverá revalidar todas as condições necessárias no seu próprio contexto de execução; esta resposta não constitui uma autorização ou token para envio. Na simulação, ela não bloqueia a preparação nem os lotes, que não chamam fornecedores.

## Proteção do telefone consultado

Aplicar migração **012**. `eligibility_checks.phone_normalized` registra o telefone usado na tentativa, sem expô-lo na resposta. O serviço envia esse telefone esperado à reserva; se o contato já mudou, a reserva é rejeitada antes da chamada ao fornecedor. Se mudar durante a consulta, a finalização retorna `unknown/contact_changed`, preservando o telefone originalmente consultado. Um opt-out atual continua prevalecendo.

Registros anteriores à migração ficam com telefone nulo. Eles não são preenchidos a partir do contato atual, porque isso inventaria qual número foi consultado. A revisão os considera inválidos até uma nova consulta autorizada. Uma nova tentativa substitui o telefone e o resultado anteriores conforme a regra existente de última tentativa prevalecer.

## Validação atual

A bateria final passou com 442 testes, nove verificações de domínio em PostgreSQL nativo e sete cenários Chromium. Inclui isolamento, revisões, consentimento, snapshot, reserva multiprocesso, resultado incerto sem reenvio, callbacks e controles. Consulte [validação](validation.md) para evidências e limites.

Contas, agentes lançados, envio RCS real e deployment de VPS ficam para configuração posterior. Declarações locais não atestam a evidência de consentimento nem entrega real.
