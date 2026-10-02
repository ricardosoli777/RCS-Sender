# Validação da fundação 5.3.0

A Wave 2 foi implementada, mas permanece aberta até executar integração com PostgreSQL/Redis e o fluxo completo no navegador. Esta sessão não encontrou `.env`, serviços locais de PostgreSQL ou Redis. O repositório também não tem commits locais; referências a uma CI antiga não são evidência da árvore atual.

## Verificações locais

Build, TypeScript e lint foram executados. Testes cobrem cookies, expiração, revogação, contas desativadas, isolamento de workspace, permissões explícitas, cadastro, CSRF, limite de login, falha de Redis e proxy web. A verificação das dependências de produção não encontrou vulnerabilidades conhecidas no npm nesta sessão.

O controle de requisições segue [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) e a autorização segue [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). A ordem dos hooks foi conferida na [documentação do Fastify](https://fastify.dev/docs/latest/Reference/Hooks/), o proxy nos [Route Handlers do Next.js](https://nextjs.org/docs/app/getting-started/route-handlers) e a configuração de E2E em [Playwright Web Server](https://playwright.dev/docs/test-webserver).

Testes com serviços reais ficam desabilitados sem `RUN_SERVICE_TESTS=1`; isso não conta como validação integrada. O teste Playwright foi preparado para cadastro, login, logout, isolamento entre duas contas e troca de workspace. A CI foi configurada para executá-lo, mas ainda não há resultado dessa execução.

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
pnpm test:e2e
```

E2E usa portas 3100 e 3101 e carrega `DATABASE_URL`/`REDIS_URL` do `.env`. Essas portas precisam estar livres. Após os testes:

```powershell
Remove-Item Env:RUN_SERVICE_TESTS
```

O fechamento da wave exige resultado positivo das migrações, persistência, rollback quando falha a auditoria, proteção do último proprietário, isolamento, prontidão e E2E. Campanhas, credenciais de provedores, mídia e analytics receberão seus próprios testes de isolamento quando forem implementados.
