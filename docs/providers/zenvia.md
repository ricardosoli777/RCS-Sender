# Zenvia RCS

Revisão documental: 04/10/2026. Adaptador disponível para configuração, com testes de contrato locais e sem confirmação remota implementada de conta/agente.

Credenciais: apiToken, sender, subscriptionId e webhookToken. POST /v2/channels/rcs/messages usa x-api-token, canal RCS e destinatário normalizado. Aceite exige ID, canal, remetente e destinatário compatíveis.

Implementados conforme o OpenAPI: text, replyable_text, card, carousel e file para imagens PNG/JPEG. Cards incluem título, texto, mídia e botões; respostas rápidas globais são separadas. URLs de imagens são grants temporários do host e nunca IDs privados.

Callbacks exigem o header x-rcs-webhook-token configurado na subscription. Esse token autentica a requisição e não é apresentado como HMAC. Subscription, canal, remetente, destinatário e datas são validados. Entrega, leitura, falha, texto e postbacks recebidos são normalizados.

Elegibilidade, PDF, consulta remota individual, revogação e billing não são declarados implementados; o agente permanece pendente. Limite local conservador compartilhado de uma chamada/segundo e respeito a Retry-After. Sem fallback SMS ou repetição automática do POST.

Referências: [OpenAPI oficial](https://zenvia.github.io/zenvia-openapi-spec/v2/openapi.json), [referência](https://zenvia.github.io/zenvia-openapi-spec/v2/).
