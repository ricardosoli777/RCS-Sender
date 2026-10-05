# Google RCS for Business

Revisão documental: 04/10/2026. Adaptador disponível no catálogo para configurar; conexões reais continuam não verificadas até teste explícito. A construção usa documentação oficial e transporte simulado; conta, agente lançado, credenciais e envios reais ficam para a ativação posterior.

Credenciais: `clientEmail`, `privateKey` RSA, `agentName`, `region` e `webhookToken`. OAuth usa a biblioteca oficial, scopes separados e cache apenas no contexto da operação. Hosts regionais fixos, cancelamento, respostas limitadas e ausência de retry automático de POST.

Implementados: texto, rich card, carrossel, imagens PNG/JPEG, respostas sugeridas e ações HTTPS. A mídia sai pelo grant temporário vinculado à tentativa e à versão imutável. Elegibilidade e capacidades do destinatário usam `phones.getCapabilities`: 404 significa não alcançável; autenticação, indisponibilidade ou resposta inválida mantêm desconhecido.

Callbacks: desafio inicial com comparação do client token; envelope Pub/Sub e HMAC-SHA512 sobre os bytes de `message.data`; entrega, leitura, texto, respostas/ações e SUBSCRIBE/UNSUBSCRIBE. A existência de um tipo documentado não comprova sua disponibilização na conta. Subscribe não remove opt-out nem concede consentimento. IDs locais determinísticos são persistidos antes do POST e permitem correlacionar callbacks após uma resposta ambígua, sem reenvio.

PDF, revogação, consulta remota individual, custos e billing não são declarados implementados. A proteção compartilhada limita chamadas conservadoramente a uma por segundo por identidade de conta e respeita 429; não representa a quota contratada.

Referências: [agente](https://developers.google.com/business-communications/rcs-business-messaging/reference/business-communications/rest/v1/brands.agents/get), [envio e conteúdo](https://developers.google.com/business-communications/rcs-business-messaging/reference/rest/v1/phones.agentMessages), [capacidades](https://developers.google.com/business-communications/rcs-business-messaging/reference/rest/v1/phones/getCapabilities), [webhooks](https://developers.google.com/business-communications/rcs-business-messaging/guides/integrate/webhooks), [eventos](https://developers.google.com/business-communications/rcs-business-messaging/reference/rest/v1/UserEvent.EventType), [respostas](https://developers.google.com/business-communications/rcs-business-messaging/reference/rest/v1/SuggestionResponse).

Provas reais opcionais: `RUN_GOOGLE_RBM_TESTS=1` e `RCS_GOOGLE_PROOF_CREDENTIALS_FILE` para leitura; envio exige também `RUN_GOOGLE_RBM_SEND_TEST=1` e `RCS_GOOGLE_PROOF_RECIPIENT`. Não executar sem autorização explícita para enviar.
