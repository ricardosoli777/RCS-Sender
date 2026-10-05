# Provedores RCS

O catálogo inclui cinco adaptadores disponíveis para configuração: [Google RBM](google-rbm.md), [Infobip](infobip.md), [Twilio](twilio.md), [Sinch](sinch.md) e [Zenvia](zenvia.md). O titular autorizou liberar a escolha de fornecedores pelo painel. Em **Integrações**, proprietários e administradores podem cadastrar conexões, substituir credenciais e iniciar um teste explícito. Salvar não testa nem envia automaticamente. O [Mock RCS](mock.md) é exclusivo de testes locais e não representa evidência externa.

Todos têm tradução de texto e formatos avançados documentados, com validação própria de limites, mídia e sugestões. O suporte exato fica na matriz do adaptador; formatos desconhecidos ou não implementados são bloqueados. Imagens servidas aos fornecedores são PNG/JPEG por grants temporários. PDF não é suportado.

Google e Infobip implementam consultas síncronas de elegibilidade; Sinch implementa consulta assíncrona com callback correlacionado à última tentativa. Twilio e Zenvia mantêm elegibilidade desconhecida, sem inventar endpoint. O resultado depende de agente, credenciais, destinatário e estado atuais.

Callbacks são autenticados conforme cada contrato: assinatura Google/Sinch, SDK Twilio, Basic do perfil Infobip e token de assinatura de subscrição Zenvia. Normalização não transforma IDs de mensagens recebidas em IDs de mensagens enviadas. Respostas sugeridas carregam correlação da tentativa do host para o motor de jornada.

## Núcleo e segurança

`RcsProvider` define capacidades, limites, agentes, envio, saúde e callbacks. Os cinco adaptadores construídos dispensam uma prova global de conexão para permitir configuração; a evidência de teste externo continua falsa e cada conexão nasce `unverified`. O envio mantém validações de conexão, agente, destinatário e consentimento. Outros registros continuam exigindo todos os checks por padrão. Flags locais e testes com transporte simulado não substituem confirmação da conta externa.

Limite atual: Google implementa consulta remota de acesso ao agente. Infobip, Twilio, Sinch e Zenvia ainda devolvem acesso desconhecido no teste de conexão; o painel informa a falta de confirmação e não marca a conexão como verificada. Os agentes permanecem pendentes sem confirmação de disponibilidade. Disponível para cadastrar não significa que uma conta real já está liberada para envio.

Para Twilio, o ID da conexão na URL de callback é fixado pelo servidor ao salvar, evitando exigir que o usuário conheça um UUID ainda não criado. O painel mostra a URL final para configurar no fornecedor; substituições também preservam esse vínculo.

Conexões e credenciais pertencem ao workspace, com FKs compostas e AES-256-GCM com contexto autenticado. APIs nunca retornam plaintext ou ciphertext. Criação, substituição e teste revalidam permissões atuais e gravam auditoria atômica. Agentes têm vínculo exclusivo persistente; rotação não libera a reserva.

| Rota de workspace | Operação |
| --- | --- |
| `GET /providers/catalog` | Catálogo e capacidades públicas |
| `GET /providers` | Conexões sem segredos |
| `POST /providers` | Criação não verificada |
| `PUT /providers/:id/credentials` | Substituição de credenciais |
| `POST /providers/:id/test` | Teste explícito, sem mensagem |

As rotas têm prefixo `/workspaces/:workspaceId` e exigem `providers.manage`; mutações exigem origem e `X-RCS-Request: 1`. Sem adaptador ativo, criação retorna conflito. Sem chave de cifra, persistência falha fechada.

O dispatcher persiste a tentativa antes do HTTP e nunca repete automaticamente um POST ambíguo. Google pode reservar seu ID remoto localmente antes do envio; callbacks autenticados podem acrescentar evidência de entrega mesmo quando o resultado original ficou incerto. Não existe consulta universal de status inventada.

Há orçamento compartilhado por fornecedor/conta/ambiente de uma chamada por segundo, com respeito a Retry-After. Essa é uma política conservadora do app, não uma declaração de quota oficial. Erros permanentes não entram em repetição; retomadas internas usam backoff com jitter e limite de tentativas.

Use [TEMPLATE.md](TEMPLATE.md) para novas integrações. Consulte [validação](../validation.md) para os resultados locais e mantenha documentação, teste de contrato e prova real como evidências separadas.
