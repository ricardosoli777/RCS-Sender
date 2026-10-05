# Validação final da construção — 04/10/2026

A construção local das waves foi verificada com fontes e migrações atuais. Credenciais e chamadas RCS reais foram reservadas pelo usuário para depois; não foram executadas.

| Verificação | Evidência |
| --- | --- |
| Suíte completa | 443 testes passaram na revisão 3ef8f44; duas provas Google opt-in e um cenário multiprocesso reservado para o comando nativo foram pulados; [CI](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37248212199). O registro anterior de 442 testes é histórico. |
| Domínio PostgreSQL nativo | Nove verificações passaram; inclui seis processos concorrentes e um único acionamento do adaptador local; `.planning/native-domain-completion.log` |
| Chromium | Sete cenários E2E passaram; `.planning/e2e-completion.log` |
| Build, tipos, tipos E2E e lint | Logs `*-completion.log` em `.planning/` |
| Instalação limpa | 357 fontes em cópia isolada, `--offline --frozen-lockfile` e build completo; `.planning/clean-install-completion.log` |
| Backup/restauração | `pg_dump`, checksum e `pg_restore` em `rcs_restore_final34_20261004`; 34 migrações e contagens iguais à origem |
| Release | Links locais e padrões selecionados de segredos; não substitui scanner completo |

A suíte cobre isolamento de workspaces, permissões atuais, versões imutáveis, consentimento/opt-out, reserva antes do HTTP, não repetição de resultado incerto, recuperação de filas, callbacks autenticados e cifrados, elegibilidade assíncrona, mídia temporária, limites compartilhados, rotação e compactação. Jornadas foram verificadas com várias mensagens, respostas vinculadas à tentativa e leitura/resposta antecipadas antes do avanço do nó.

Os sete E2E exercitam autenticação/workspaces, quotas do proxy, mensagens, campanhas, consentimentos, editor visual/autosave e categoria/carrossel/seleção de caminho com preservação da versão ativa. Não são uma auditoria completa de acessibilidade.

PostgreSQL 18.6 e Redis 8.0.5 foram usados em WSL nas portas isoladas 15432/16379. A CI da revisão 3ef8f44 também passou com PostgreSQL 17/Redis 7, incluindo nove verificações nativas (seis processos e exatamente um acionamento local) e sete E2E Chromium. Na VPS, as nove verificações nativas passaram em um PostgreSQL 17 isolado, antes da ativação pública.

Os testes de volume em PGlite continuam complementares, sem promessa de throughput. Os testes nativos usam schemas isolados; o ensaio de restore cria um banco novo com prefixo obrigatório e não substitui um banco existente.

## Repetir as verificações

```powershell
pnpm build
pnpm typecheck
pnpm typecheck:e2e
pnpm lint
pnpm test
pnpm release:check
```

Para serviços, defina `RUN_SERVICE_TESTS=1`, `DATABASE_URL` e `REDIS_URL` de ambientes exclusivos de teste. Então rode `pnpm test`, `pnpm test:native:domain` e `pnpm test:e2e`. E2E usa portas 3100/3101, migra o banco e cria contas de teste. Chromium deve estar instalado. Nunca use produção.

Com clientes PostgreSQL nativos, execute `bash ops/native-backup-drill.sh ENV_FILE BACKUP_DIRECTORY rcs_restore_ensaio`. Preserve as chaves de cifra junto à estratégia de recuperação, sem publicá-las.

Duas provas Google continuam opt-in e não constituem obrigação para construir o app. Docker/VPS, HTTPS público, smoke, backup/restore e rollback do serviço têm [evidência de implantação](deployment-arkitekt.md). Ativação de agentes e entrega RCS real continuam sem execução, conforme decisão do usuário. Consulte [prontidão](production-readiness.md). O histórico anterior está em [CHANGELOG.md](../CHANGELOG.md).
