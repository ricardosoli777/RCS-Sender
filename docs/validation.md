# Validação da fundação 5.3.0

A Wave 4 foi concluída na [CI do commit `91c448d`](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37130522235), em 03/10/2026. Build, TypeScript, lint, 37 testes com PostgreSQL/Redis e dois cenários E2E passaram. O fluxo de navegador agora inclui adicionar uma conta existente à equipe, alterar seu perfil, remover o vínculo, bloquear a remoção do último proprietário, negar gestão a leitores e trocar de workspace preservando Configurações. Verificações de transbordamento passaram em 320/375 pixels. As capturas do painel e de Configurações foram inspecionadas no desktop e no celular; a tabela se adapta para apresentar todas as ações no celular. A CI também confirmou que a CSP estrita continua bloqueando scripts inseridos no HTML. Não foi realizada auditoria completa WCAG nem validação pública na VPS.

A Wave 2 foi validada na [CI do commit `982fe2f`](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37126723421), concluída com sucesso em 03/10/2026. Instalação com lockfile fixo, build, TypeScript dos pacotes e E2E, lint, 29 testes (incluindo os três com PostgreSQL/Redis) e o fluxo completo no Chromium passaram. As Waves 1 e 2 estão encerradas; a Wave 3 de segurança continua em andamento e a plataforma ainda não está pronta para produção.

Não foram encontrados `.env` nem executáveis de PostgreSQL ou Redis no PATH local. A validação integrada ocorreu em serviços temporários da CI; a instalação local com serviços reais continua pendente na Wave 0.

Na Wave 3, a [CI do commit `771967a`](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37127239589) passou em 03/10/2026 por build, TypeScript, lint, 32 testes e E2E no Chromium. Os testes novos verificam cancelamento de uploads parados/desconectados antes de chegar à API, liberação do leitor do corpo e ocultação de segredos e cookies nos logs. O E2E confere cabeçalhos de segurança da interface e ausência de `X-Powered-By` e mantém o fluxo de autenticação e workspaces.

A [CI do commit `33c37f8`](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37128356107), também concluída em 03/10/2026, validou as pendências seguintes: CSP com nonce por requisição e limites por IP autenticado na cadeia de proxy. Build, TypeScript, lint, 37 testes com PostgreSQL/Redis e dois cenários E2E passaram. Os cenários conferem bloqueio de script inserido no HTML recebido, nonces diferentes entre requisições, ausência dos segredos nos cabeçalhos da resposta, rejeição de token/IP falsificados e limites Redis independentes por cliente. O teste da API também verifica rejeição de pares fora do loopback e agrupamento IPv6 por /64. A Wave 3 continua aberta somente para validar a configuração real de proxy, HTTPS e firewall na VPS; a CI simula a borda e não comprova uma implantação pública.

O repositório tem histórico local e remoto. A [CI do commit `d3d6963`](https://github.com/ricardosoli777/RCS-Sender/actions/runs/36989730153), executada em 02/10/2026, falhou em `pnpm typecheck:e2e`: os tipos do Node.js não estavam declarados na raiz do monorepo. A retomada corrigiu essa dependência, o conflito UUID/texto na auditoria de criação de workspace e o nível de log inválido do servidor E2E. O teste integrado agora confere também os IDs do workspace e do autor no evento de criação. A execução bem-sucedida acima valida as três correções.

## Verificações locais

Em 03/10/2026, build, TypeScript dos pacotes e E2E, lint e 26 testes passaram localmente; três testes com serviços reais foram pulados localmente e depois passaram na CI. A instalação offline com `--frozen-lockfile` e a descoberta do teste Playwright também passaram após a correção dos tipos. Testes cobrem cookies, expiração, revogação, contas desativadas, isolamento de workspace, permissões explícitas, cadastro, CSRF, limite de login, falha de Redis e proxy web. A auditoria `pnpm audit --prod --audit-level high` foi repetida em 03/10/2026 e não encontrou vulnerabilidades conhecidas.

O controle de requisições segue [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) e a autorização segue [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). A ordem dos hooks foi conferida na [documentação do Fastify](https://fastify.dev/docs/latest/Reference/Hooks/), o proxy nos [Route Handlers do Next.js](https://nextjs.org/docs/app/getting-started/route-handlers) e a configuração de E2E em [Playwright Web Server](https://playwright.dev/docs/test-webserver).

Testes com serviços reais ficam desabilitados sem `RUN_SERVICE_TESTS=1`; isso não conta como validação integrada local. Na CI validada, todos foram habilitados. O teste Playwright executou cadastro, login, logout, isolamento entre duas contas e troca de workspace.

## Comandos de código

```powershell
pnpm build
pnpm typecheck
pnpm typecheck:e2e
pnpm lint
pnpm test
pnpm test:e2e --list
pnpm audit --prod --audit-level high
```

## Testes com serviços reais

Use PostgreSQL e Redis exclusivos de teste, nunca de produção. A integração cria e remove um schema próprio; E2E aplica migrações e cria contas de teste no banco escolhido. Redis armazena chaves de limite temporárias.

Para carregar `.env` e habilitar os testes de integração no PowerShell:

```powershell
$env:RUN_SERVICE_TESTS='1'
pnpm --filter @rcs/database exec node --env-file=../../.env node_modules/vitest/vitest.mjs run
pnpm --filter @rcs/api exec node --env-file=../../.env node_modules/vitest/vitest.mjs run
```

Para o fluxo completo no Chromium, após build:

```powershell
pnpm exec playwright install chromium
$env:RUN_SERVICE_TESTS='1'
pnpm test:e2e
```

E2E usa portas 3100 e 3101 e carrega `DATABASE_URL`/`REDIS_URL` do `.env`. Essas portas precisam estar livres. Após os testes:

```powershell
Remove-Item Env:RUN_SERVICE_TESTS
```

A CI validada confirmou migrações idempotentes, persistência, rollback quando falha a auditoria, proteção do último proprietário, isolamento, prontidão e E2E, atendendo ao fechamento da Wave 2. Campanhas, credenciais de provedores, mídia e analytics receberão seus próprios testes de isolamento quando forem implementados.
