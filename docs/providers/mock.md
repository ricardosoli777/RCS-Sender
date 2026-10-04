# Mock RCS — evidência local

Revisão: 03/10/2026. Adaptador de simulação da Wave 6, em `packages/providers/src/mock.ts`. Não representa integração ou capacidades verificadas de qualquer fornecedor RCS. Não usa rede nem envia mensagens reais. Não está registrado automaticamente na API ou no worker.

## Contrato e configuração

`MockRcsProvider` implementa `RcsProvider`. O único ambiente é `test`; a única credencial é `webhookSecret`, com 32 a 256 caracteres e pelo menos 32 após remover espaços nas extremidades. Use um segredo exclusivo de teste. Ambiente de produção, campos extras, credenciais inválidas e contexto cancelado são rejeitados. A descoberta retorna o agente local `mock-agent`.

O construtor aceita `scenario` (`success`, `rejected`, `rate_limited` ou `unavailable`), relógio `now` e limite `maxMessages` (padrão: 1000). A configuração fica no código de teste; contatos e conteúdo de mensagens não selecionam cenários. Credenciais inválidas produzem `invalid_credentials`; rate limit informa repetição em cinco segundos. Erros canônicos têm mensagens fixas e somente falhas transitórias permitem repetição.

Texto, rich card, mídia, arquivo, carrossel, respostas sugeridas, ações HTTPS e consulta de estado são suportados na simulação. Limites locais: texto 3072 pontos de código, título 200, dez cards, quatro sugestões por grupo. Mídia usa IDs locais; nenhum asset é baixado ou validado contra armazenamento. Elegibilidade, capacidades por destinatário, revogação, estimativa de custo e cobrança são explicitamente não suportadas. Não há rate limit real; o cenário correspondente é uma falha controlada.

Envios exigem destinatário internacional `+` e 8 a 15 dígitos, agente existente e chave de idempotência não vazia de até 256 caracteres. O mesmo request serializado com a mesma chave, workspace, conexão e ambiente retorna o mesmo ID. Conteúdo diferente na mesma chave falha. O estado é exclusivo da instância e limitado; ao atingir capacidade, novos envios falham fechados, preservando as chaves anteriores. Reiniciar ou recriar a instância perde o estado. A consulta retorna uma cópia do evento `message.sent` e impede consultar mensagens de outra conexão ou workspace.

## Webhook simulator

`simulateWebhook(context, inputs)` cria um request local, sem HTTP, com corpo JSON e cabeçalhos `x-mock-timestamp` (milissegundos Unix) e `x-mock-signature` (HMAC-SHA256 hexadecimal). A assinatura cobre o array JSON `[workspaceId, connectionId, environment, timestamp]`, um ponto e os bytes exatos do corpo. O segredo é o `webhookSecret` da conexão. O timestamp tem tolerância de cinco minutos em ambas as direções. O corpo tem limite de 64 KiB e cada lote até 100 eventos.

O algoritmo usa as APIs oficiais [createHmac](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehmacalgorithm-key-options) e [timingSafeEqual](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptotimingsafeequala-b) do Node.js, consultadas nesta revisão. O formato assinado é próprio do mock e não deve ser aplicado a fornecedores reais. Não existem endpoints externos, versão de API de fornecedor nem ciclo de tokens.

`parseWebhook` verifica a assinatura antes de ler JSON e rejeita o lote inteiro em caso de evento inválido. Valida UTF-8, tipo de evento, campos permitidos, isolamento, destinatário e data. Eventos de mensagem exigem `providerMessageId`; falha exige erro; resposta recebida exige mensagem de texto; seleção exige `actionPayload`. Conteúdo recebido é texto simples nesta versão. Erros recebidos são convertidos para mensagens canônicas, sem propagar texto bruto. São simulados os oito eventos canônicos, incluindo inscrição e cancelamento de inscrição.

Eventos simulados não alteram o estado interno de envios nem demonstram entrega real. Repetições válidas dentro da janela continuam verificáveis: deduplicação persistente de eventos, transições de entrega e processamento HTTP ficam para o Webhook Engine. O simulador não é um serviço público de webhook.

## Evidência e limites

Os testes em `packages/providers/src/mock.test.ts` cobrem credenciais, conexão, capacidades, agentes, formatos de mensagem, resposta e erro canônicos, idempotência concorrente, conflitos, isolamento, cópias de estado, cancelamento, capacidade máxima, assinatura, parsing e normalização. Testes negativos incluem corpo alterado, segredo/contexto diferente, timestamp expirado ou futuro, assinatura ausente/inválida, JSON/UTF-8 inválidos, lotes grandes e eventos malformados.

Não se alteraram dependências, variáveis de ambiente, permissões, migrações ou endpoints. A validação é local e não demonstra integração com fornecedor, PostgreSQL/Redis, navegador ou VPS. Consulte [validação](../validation.md) para os resultados. A API lista cinco adaptadores externos inativos por padrão; uma ativação futura deverá fornecer explicitamente a evidência exigida pelo `ProviderRegistry`.
