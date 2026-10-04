# Sinch Conversation RCS

Revisão documental: 04/10/2026. Adaptador inativo por padrão, sem prova real de conta ou agente.

Credenciais: `projectId`, `appId`, `keyId`, `keySecret`, `region` (us/eu) e `webhookSecret`. Hosts regionais fixos e Basic para a API. Envio via messages:send com prioridade exclusiva RCS, sem fallback nem retry de POST.

Implementados: texto, choice_message, card_message, carousel_message e media_message para PNG/JPEG resolvidos pelo host. Limites particulares e sugestões em posições incompatíveis são recusados. O aceite exige message_id.

Elegibilidade é assíncrona: capability:query registra request_id e app_id, mantendo o contato desconhecido enquanto aguarda capability_notification. FULL confirma, NO_CAPABILITY rejeita e PARTIAL/UNKNOWN permanecem desconhecidos. Callback só atualiza a solicitação vigente, dentro da validade, com telefone, credenciais, workspace e solicitante ainda válidos. Opt-out prevalece.

Assinatura HMAC-SHA256 cobre corpo bruto, nonce e timestamp, com tolerância de cinco minutos na entrada. O processamento durável não rejeita um callback autenticado por atraso da fila. Entrega, leitura, falha, texto e choice_response_message são normalizados.

PDF, revogação, billing, custos e consulta remota individual não são implementados. Limite local conservador de uma chamada/segundo por conta, com cooldown em 429. O agente permanece pendente até evidência externa.

Referências: [Conversation API](https://developers.sinch.com/docs/conversation/api-reference/conversation/), [callbacks](https://developers.sinch.com/docs/conversation/callbacks), [suporte RCS](https://developers.sinch.com/docs/conversation/channel-support/rcs).
