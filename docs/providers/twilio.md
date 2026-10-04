# Twilio RCS

Revisão documental: 04/10/2026. Adaptador inativo por padrão; sem acesso real à conta.

Credenciais: accountSid, authToken, sender e webhookUrl HTTPS exatamente vinculada à conexão. Texto simples usa Messages.json com From/To rcs:. Conteúdo estruturado cria primeiro um recurso na Content API, valida seu HX SID e envia ContentSid. A friendly_name determinística não é uma garantia de idempotência remota. Uma criação ambígua não é repetida automaticamente.

Implementados: texto, imagens PNG/JPEG, cards, carrosséis e respostas/URLs. Limites da Content API são validados: título, corpo, rótulos, imagens e quantidade/ordem de botões por cartão. Carrossel exige imagem e um ou dois botões por cartão; sugestões globais não são descartadas silenciosamente.

Callbacks form-urlencoded usam validateRequest do SDK oficial com URL configurada e corpo exato. Campos duplicados, conta, agente, canal ou vínculo incompatíveis são recusados. ButtonPayload normaliza respostas e transporta correlação à tentativa do host. Entrega, leitura, falha e texto são normalizados.

Elegibilidade, PDF, revogação, billing, custos e consulta remota individual não são declarados implementados. O fluxo conserva desconhecido quando não existe contrato integrado de elegibilidade. O agente permanece pendente. Limitador local compartilhado de uma chamada/segundo, com 429.

Referências: [RCS](https://www.twilio.com/docs/rcs/send-an-rcs-message), [Content API](https://www.twilio.com/docs/content/content-api-resources), [cards](https://www.twilio.com/docs/content/twiliocard), [carrosséis](https://www.twilio.com/docs/content/carousel), [ButtonPayload](https://www.twilio.com/en-us/changelog/rcs-button-payload), [assinatura](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
