# Validação da fundação 5.3.0

A Wave 2 foi implementada, mas permanece aberta até executar integração com PostgreSQL/Redis e o fluxo completo no navegador. Na retomada de 03/10/2026, não foram encontrados `.env` nem executáveis de PostgreSQL ou Redis no PATH.

O repositório tem histórico local e remoto. A [CI do commit `d3d6963`](https://github.com/ricardosoli777/RCS-Sender/actions/runs/36989730153), executada em 02/10/2026, passou por instalação, build e TypeScript dos pacotes, mas falhou em `pnpm typecheck:e2e`: os tipos do Node.js não estavam declarados na raiz do monorepo. Ela parou antes de lint, testes de integração e Chromium. A correção declara `@types/node` na raiz, atualiza o lockfile e especifica os tipos no projeto E2E. Ainda é necessário executar a CI com essa correção.

## Verificações locais

Em 03/10/2026, build, TypeScript dos pacotes e E2E, lint e 26 testes passaram localmente; três testes com serviços reais foram pulados. A instalação offline com `--frozen-lockfile` e a descoberta do teste Playwright também passaram após a correção dos tipos. Testes cobrem cookies, expiração, revogação, contas desativadas, isolamento de workspace, permissões explícitas, cadastro, CSRF, limite de login, falha de Redis e proxy web. A verificação das dependências de produção feita na sessão anterior não encontrou vulnerabilidades conhecidas no npm; ela não foi repetida nesta retomada.

O controle de requisições segue [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) e a autorização segue [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). A ordem dos hooks foi conferida na [documentação do Fastify](https://fastify.dev/docs/latest/Reference/Hooks/), o proxy nos [Route Handlers do Next.js](https://nextjs.org/docs/app/getting-started/route-handlers) e a configuração de E2E em [Playwright Web Server](https://playwright.dev/docs/test-webserver).

Testes com serviços reais ficam desabilitados sem `RUN_SERVICE_TESTS=1`; isso não conta como validação integrada. O teste Playwright foi preparado para cadastro, login, logout, isolamento entre duas contas e troca de workspace. A CI está configurada para executá-lo, mas a execução consultada parou antes dessa etapa.

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

O fechamento da wave exige resultado positivo das migrações, persistência, rollback quando falha a auditoria, proteção do último proprietário, isolamento, prontidão e E2E. Campanhas, credenciais de provedores, mídia e analytics receberão seus próprios testes de isolamento quando forem implementados.
