# Changelog

## 2026-10-04 — conclusão da construção local das waves

- Formatos avançados nos cinco adaptadores documentados; elegibilidade Google/Infobip e Sinch assíncrona, autenticação específica dos callbacks e desafios Google. Contas continuam desativadas até configuração posterior.
- Grants de mídia vinculados ao envio, limites compartilhados por conta, reconciliação por callback preservando resultado incerto, rotação auditada e compactação limitada. Migrações 028–034.
- Categorias imutáveis, carrossel e seletor de caminho; correlação de respostas com a tentativa mais recente e recuperação de leitura/resposta antecipada. Backoff interno com jitter, sem repetição automática de POST incerto.
- Correções de acessibilidade dos seletores e de chaves React duplicadas nos painéis de campanha. CI inclui domínio PostgreSQL nativo com seis processos independentes.
- 442 testes, nove verificações de domínio nativo e sete E2E Chromium passaram; build/tipos/lint, instalação isolada e backup/restore com 34 migrações passaram. Sem push, deployment, ativação externa ou envio RCS real. Veja docs/validation.md.

## Em desenvolvimento — Especificação 6.0.0

- Integração da fila de despacho: núcleo/outbox/runtime compartilhados em @rcs/dispatch; consulta/enqueue protegidos na API/proxy, painel com confirmação e contagens, relay/consumidor ligados ao worker. Falta de chaves/adaptador compatível não consome jobs. Shutdown preserva intenções sem ledger; resultados incertos não reenviam. Dezessete novos casos; 314 testes locais, build, tipos e lint passaram. Registro padrão de provedores vazio; nenhuma chamada externa.

- Outbox interna de despacho (migração 016): enqueue atômico por audiência confirmada, lease, geração, recuperação pelo ledger e cinco claims somente sem tentativa registrada. Resultados incertos não reenviam; cancelamento antes de qualquer tentativa descarta a fila. Relay BullMQ preparado, sem registro no worker ou comando de envio. Treze novos testes SQL e dois de relay; veja docs/campaign-dispatch-outbox.md.

- Interface de consentimento RCS por contato: consulta por finalidade, declaração/revogação com evidência e data UTC explícitas, confirmação, revisão/telefone da leitura e bloqueio até recarga após conflito ou resultado inconclusivo. Leitores consultam sem gravar; opt-out continua visível. Troca de workspace retorna à lista de contatos. Oito novos testes de formulário/renderização; 282 testes locais, build, tipos e lint passaram. Cenário Playwright preparado e descoberto, sem execução no navegador. Sem chamadas externas ou jobs reais.
- Registro local de consentimento RCS por telefone/finalidade: declaração/revogação com referência de evidência, telefone/revisão esperados, observação válida, histórico imutável e auditoria atômica. API/proxy de consulta/registro e bloqueio no dispatcher antes da reserva e antes de send. Importação não concede consentimento; opt-out não é removido. Migração 015 e 17 novos casos SQL/HTTP/proxy; 274 testes locais, build, tipos e lint passaram. Interface/captura automática e worker de envio real pendentes; nenhuma chamada externa.
- API, proxy e painel de preparação de despacho: consulta com contagens congeladas, preparação, confirmação explícita e cancelamento antes de qualquer tentativa. Histórico preservado, revisões/CSRF/permissões revalidados, contratos estritos e envio indisponível explicitamente. 12 novos casos SQL/HTTP/proxy/renderização; 257 testes locais, build, tipos e lint passaram. Cenário Playwright atualizado e descoberto, sem execução. Consentimento e worker de envio real pendentes; nenhuma chamada externa.
- Preparação e confirmação internas do despacho: run/audiência imutáveis, telefone e configuração congelados, confirmação separada com revisão atual e auditoria atômica. O núcleo exige snapshot confirmado; novos membros e contatos inicialmente suprimidos ou indisponíveis não entram no despacho. Migração 014 e 21 novos casos SQL; 245 testes locais, build, tipos e lint passaram. Sem interface/API de confirmação, consentimento, worker de envio real ou chamadas externas.
- Núcleo interno de despacho de texto simples: ledger SQL por destinatário, chave estável, validação de agente/capacidades, rechecagem SQL antes de `send`, resultados canônicos e prazo de dez segundos. Reentregas não reenviam; falha de resultado preserva `sending`, timeout permanece `unknown`. Migração 013 e dezessete testes com adaptador fixture; 224 locais, build, tipos e lint passaram. Ainda sem ligação a API/worker ou envio externo.
- Preflight local de campanhas passa a agregar elegibilidade salva por conexão/telefone, distinguir resultados válidos/expirados/desconhecidos/ausentes e apontar mídia privada não publicada, credenciais ausentes e agente sem vínculo. Migração 012 registra telefone da consulta e invalida mudança antes/durante a tentativa; checks antigos sem telefone não são preenchidos retroativamente. Nove novos testes; 207 locais, build, tipos e lint passaram. Sem chamada externa ou autorização de envio real.
- Simulação em segundo plano: outbox transacional, enqueue explícito, relay por data e worker BullMQ com lotes encadeados. Revalida solicitante/estado/revisão; pausa/parada e intervenção manual descartam automação. Cinco tentativas persistidas com backoff e estado `dead`. Migração 011; oito testes SQL/HTTP e quatro de relay, proxy ampliado. Envio real permanece pendente.
- Início da Wave 15: simulação explícita persistida, congelamento de audiência/versão, lotes de até 50, revisão contra repetição e pausa/retomada/cancelamento/parada local; migração 010. Interface distingue resultados simulados. Onze novos testes; 186 testes locais, build, tipos e lint passaram. Envio real, fila e agendador automático permanecem pendentes.

- Interface inicial de campanhas: listagem/filtro/paginação, criação/edição de rascunhos, seletores paginados de conexões/listas/snapshots ativos, UTC explícito, revisão local e cancelamento confirmado. Seleções vinculadas permanecem diante de paginação, falhas ou ativação de nova mensagem. Sete novos testes; cenário E2E preparado, ainda sem execução.

- Domínio inicial de campanhas: rascunhos, revisões, snapshot fixado de mensagem, conexão/agente/audiência, data UTC, cancelamento de rascunho e revisão local sem envio; migração 009. Onze testes do módulo e um do proxy.
- Listas usadas por campanhas são preservadas; tentativa de exclusão retorna conflito com mensagem na interface. Leitura de campanhas concedida também aos perfis que já gerenciam campanhas.

- Construtor inicial de texto e rich card: edição versionada, prévia ao vivo, contadores Unicode, ações HTTPS, respostas sugeridas, upload e seleção de mídia privada. Comparação com capacidades/limites declarados por adaptadores por rota de leitura sem credenciais. Seis novos testes de modelo/API/proxy; cenário E2E ampliado, ainda não executado.

- Biblioteca inicial de mensagens com filtro de estado, paginação, prévia privada, consulta de versões, criação de texto, ativação, arquivamento, restauração e duplicação. Troca de workspace no detalhe retorna à biblioteca. Dois novos testes de renderização; cenário Playwright preparado, ainda sem execução. Identificação do painel atualizada para SPEC 6.0.0.

- Domínio inicial de mensagens reutilizáveis: versões imutáveis, ativação explícita, arquivamento, conflitos de edição, referências de mídia por workspace e auditoria atômica; migração 008. Onze testes de validação/SQL/API e um do proxy. Biblioteca e construtor visual ainda pendentes.

- Media Service inicial: upload privado de PNG/JPEG/WebP, validação e reprocessamento com Sharp, metadados/digest por workspace, acesso binário autenticado, paginação e auditoria atômica; migração 007. Quatorze novos testes de processamento/SQL/API e um do proxy.
- Prazo ajustado somente no teste de rate limit com onze verificações reais de senha, para acomodar concorrência com as suítes SQL WASM sem reduzir as verificações.
- Núcleo inicial do Eligibility Engine: consulta por contato/conexão, persistência e auditoria, supressão por opt-out, cancelamento e proteção contra respostas obsoletas; migração 006. Quinze testes novos do serviço/SQL/API e um do proxy.
- Planejamento alinhado às Jornadas da especificação 6.0.0; o bloqueio por prova real de fornecedor foi corrigido conforme a orientação anterior do titular. Funis ainda serão implementados nas Waves 17–23.

## Em desenvolvimento — Fundação 5.3.0

- Wave 8: módulo de Contatos e Audiências com cadastro manual, importação CSV/colagem, normalização E.164, deduplicação, listas e opt-out persistente por workspace; migração 005, UI paginada, API/proxy e auditoria atômica. Dez novos testes do domínio/SQL/API e um do proxy.
- Wave 7 iniciada: prova local de Google RCS for Business com biblioteca oficial de autenticação, texto simples, UUID idempotente por conexão e endpoints regionais fixos.
- Provider Core: reserva global e imutável de agente por conexão, teste autenticado com prazo de oito segundos, auditoria atômica e rejeição de resultados após mudança de credenciais/permissões. Migração 004 e testes locais SQL com PGlite; concorrência PostgreSQL preparada na suíte integrada.
- Callbacks Google com HMAC-SHA512 sobre `message.data`, validação de agente assinado e normalização de entrega, leitura e texto recebido; 23 testes novos e dois testes reais manuais desabilitados por padrão.
- Evidência documental e divergências registradas antes do código; validação operacional externa será feita quando as APIs forem usadas.
- Orientação do titular esclarecida: construir o app e as integrações conforme a documentação oficial das empresas de RCS; credenciais e provas reais não bloqueiam a construção. Gate anterior da Wave 7 substituído, preservando a distinção entre testes locais e validação externa.

- Wave 6: MockRcsProvider local com contratos, cenários de sucesso/falha, idempotência e consulta de estado isoladas por workspace/conexão.
- Simulador dos oito eventos canônicos com HMAC vinculado ao contexto, janela temporal, payload limitado e parsing estrito; sem ativação automática na aplicação.
- Onze testes novos de contrato, isolamento e webhooks; documentação dos limites da simulação em `docs/providers/mock.md`.

- Wave 5: contratos canônicos, matriz de capacidades, registro com requisitos de ativação e framework de evidência de provedores.
- Conexões isoladas por workspace, credenciais criptografadas e auditoria transacional; API sem leitura de segredos.
- Wave 5 concluída na CI de 03/10/2026: 47 testes e dois E2E passaram, incluindo troca de ciphertext, rotação de chaves e autorização revalidada.
- Wave 4: tokens Purple Signal, fontes locais, AppShell responsivo e navegação que preserva o workspace.
- Configurações com gestão real de membros, alteração de perfis e confirmação de remoção; autorização mantida na API.
- Wave 4 concluída na CI de 03/10/2026: 37 testes e dois E2E passaram; capturas desktop/celular inspecionadas, incluindo foco do diálogo e ações móveis.
- Wave 3: CSP com nonces por requisição e limites Redis por IP autenticado na cadeia proxy público → web → API, com segredos distintos.
- CI da Wave 3 aprovada em 03/10/2026: 37 testes e dois cenários E2E, incluindo injeção no HTML e limites independentes com Redis real.
- Wave 3: cabeçalhos de segurança web, prazo para uploads no proxy, cancelamento por desconexão e ocultação de segredos/cookies nos logs.
- Tipos do Node.js declarados na raiz e no projeto E2E, corrigindo a falha da CI em instalações limpas.
- Conversão explícita de UUID na auditoria de criação de workspace, corrigindo o cadastro com PostgreSQL real.
- Servidor E2E usa nível de log aceito pela configuração tipada da API.
- Master Spec 5.3.0 validado como YAML, com arquitetura por workspaces.
- Cadastro transacional cria usuário, workspace padrão, vínculo de proprietário e sessão.
- Login/logout, cookies HttpOnly, expiração absoluta de oito horas e tokens persistidos somente como hash.
- Perfis associados ao workspace, autorização explícita e negação por padrão no servidor.
- Seletor de workspace e API de gestão de membros com proteção do último proprietário ativo.
- Auditoria operacional isolada por workspace; histórico inicial preservado em log de identidade separado.
- CSRF por origem e cabeçalho, payloads estritos, limite de login/cadastro e falha fechada de Redis.
- Proxy web com rotas aprovadas e corpo limitado; carregamento do `.env` no servidor web.
- Waves 1 e 2 validadas na CI em 03/10/2026: 29 testes com PostgreSQL/Redis e fluxo E2E no Chromium passaram.
- Documentação de autenticação, workspaces, configuração e validação atualizada.

## 0.1.0 — Fundação inicial

- Especificação 5.2.0 consolidada em `MASTER-SPEC.yaml`.
- Monorepo inicial com web, API, worker, configuração e logs.
- Documentação inicial de instalação e segurança.
- Banner Purple Signal para o README e licença própria de cópia permitida.
- Pacote de criptografia autenticada e versionada para futuras credenciais de provedores.
- Cabeçalhos de segurança e limite global de requisições na API.
- Dependências fixadas em `pnpm-lock.yaml` para instalações reproduzíveis.
- `@fastify/rate-limit` atualizado para 11.2.0, corrigindo o bypass por rotação de IPv6.
- Teste de integração da prontidão com PostgreSQL e Redis temporários na CI.
- Migração inicial de usuários, sessões e auditoria; hash de senhas com `scrypt`.
# Waves 16–29 — implementação local (2026-10-04)

- Funis com múltiplas mensagens, versões, entradas automáticas, esperas, condições, eventos, tags, pontuação, metas, webhooks e editor visual.
- Event bus cifrado, métricas, Inbox com atribuição, auditoria e recuperação operacional.
- Cinco adaptadores documentados de texto; catálogo desativado para configuração futura.
- Migrações 017–027 e arquivos Linux de deployment/backup/restore/release check. Bateria: 414 testes locais, seis externos pulados e seis E2E preparados sem navegador.
- Sem envio real ou deployment. Elegibilidade, formatos avançados, cadenciamento de despacho, retenção automática e provas nativas ainda pendentes.
