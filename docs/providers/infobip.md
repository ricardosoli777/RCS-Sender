# Infobip

Revisão documental: 04/10/2026. Adaptador inativo por padrão; testes locais não comprovam lançamento do agente nem acesso à conta.

Credenciais: `apiKey`, `baseHost`, `sender`, `webhookUsername` e `webhookPassword`. API usa autorização App e host restrito a `*.api.infobip.com`. Callbacks usam Basic configurado no Authentication Settings do Notification Profile, comparação constante e vínculo ao remetente; batches parcialmente inválidos são recusados.

`POST /rcs/2/messages` traduz texto, card, carrossel, imagens PNG/JPEG, respostas e URLs. Conteúdo privado é resolvido pelo host, sem repassar IDs de assets. O aceite exige um destinatário, ID e estado PENDING. Não há fallback SMS nem repetição automática do POST.

Elegibilidade síncrona: `POST /rcs/2/capability-check/query`, remetente e um telefone. ENABLED permite; UNREACHABLE bloqueia; demais resultados permanecem desconhecidos. Respostas precisam corresponder ao telefone consultado. Entrega, falha, leitura, texto e sugestões recebidas são normalizados; respostas correlacionadas preservam o payload original.

PDF, consulta remota individual, revogação, billing e custos não são implementados. O limitador local compartilhado usa uma chamada/segundo e respeita Retry-After, sem assumir quotas contratadas. Agente configurado permanece pendente até evidência externa.

Referências: [SDK oficial e contratos RCS](https://github.com/infobip/infobip-api-go-client/blob/master/pkg/infobip/api/rcs_api.go), [envio](https://www.infobip.com/docs/tutorials/send-rcs-messages-to-end-users), [componentes de subscription](https://www.infobip.com/docs/subscriptions/subscription-components), [autenticação de notificações](https://www.infobip.com/docs/subscriptions/manage/authentication-settings).
