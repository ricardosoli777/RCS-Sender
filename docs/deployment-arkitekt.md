# Implantação verificada — 04/10/2026

Aplicação pública: **https://rcssender.arkitekt.space**. Cadastro cria uma conta e seu workspace. A implantação foi autorizada pelo titular e feita por SSH/SFTP usando Python Paramiko; credenciais SSH, senhas, chaves de cifra e sessões não estão no Git.

## Revisões e infraestrutura

- Binários completos: commit `3ef8f44fb6571309a74b3602f0a8dbb9d1b2821a`, construídos na VPS com Node 24/pnpm 10.30.3 e lockfile congelado.
- Release inicial saudável: `b8548f09e1e0d22be45b57973d1f36bee425ce5d`, imagem `sha256:7dac166aa897047012bb5c01501684737f29e90061793e47aae155a5737fc587`. O arquivo Git teve checksum conferido antes da extração; a guarda de diff permitiu reutilizar binários apenas após confirmar que os fontes/dependências da aplicação não mudaram.
- Release atual: `/opt/rcs-sender/current/deployment.json` registra commit completo, ID da imagem, digests dos bancos e estado. Atualizações apenas de operação/documentação preservam a revisão dos binários no label `rcs.compiled-base-revision`.
- Debian 12, Docker 20.10.24, Swarm; stack independente `rcssender`, uma réplica da aplicação, banco e Redis próprios. Traefik existente atende 80/443; nenhuma porta adicional foi publicada.
- PostgreSQL 17: digest `sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652`. Redis 7: digest `sha256:c6eabf748fc7a61dbb5a705c78bcf3d6377b1127a97d0ce965c11c44ba46896f`.
- Segredos privados em `/opt/rcs-sender/shared`, arquivos com modo `600`, injetados por Docker Secrets. Preservar as chaves originais é necessário para recuperar dados cifrados.

## Provas executadas

| Verificação | Resultado |
| --- | --- |
| [CI 3ef8f44](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37248212199) | Build, tipos, lint, 443 testes, nove verificações nativas e sete E2E Chromium passaram |
| [CI b8548f0](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37248632257) | Correção operacional também passou todos os checks |
| Contrato Caddy em container Linux isolado | IP direto/Cloudflare, rejeição de spoofing, separação de callbacks e rejeição de Host incorreto passaram |
| Migração | 34 migrações aplicadas, antes da ativação pública; repetição não reaplicou mudanças |
| Saúde | Aplicação, PostgreSQL e Redis `1/1`; API pronta e heartbeat do worker saudável |
| HTTPS público | `/login` retornou `200` com validação TLS |
| HTTPS da origem | `curl --resolve rcssender.arkitekt.space:443:127.0.0.1` retornou `200`; `ssl_verify_result=0`, sem ignorar certificado |
| Smoke público | Cadastro, cookie `Secure`/`__Host-`, CSRF `403`, workspace alheio `404`, categoria atual/ativa preservada, jornada concluída pelo worker e logout/login passaram |
| Backup/restore | Dump custom, catálogo e SHA-256 conferidos; restauração transacional em `rcs_restore_initial_20261004` passou |
| Rollback do serviço | Troca para uma tag de bytes idênticos e `docker service rollback` concluíram; imagem original e saúde restauradas, HTTPS voltou a `200` |

O smoke foi executado pela estação Windows contra o domínio público usando [vps-smoke.py](../ops/vps-smoke.py), com credenciais QA apenas em `.secrets/deploy/smoke-account-final.json` ignorado pelo Git. A conta/workspace QA é identificada e usa um telefone fictício reservado. A jornada de teste contém início, tag e fim; não contém ações de envio. Os cinco adaptadores apareceram inativos e o ledger tinha zero tentativas de despacho RCS após a prova.

Backup verificado: `/opt/rcs-sender/backups/rcssender-20261005T004643Z-532262.dump`. Contagens iguais à origem e ao restore: **34 migrações, 2 usuários, 9 eventos canônicos, 1 participação em jornada e 3 transições**. A participação terminou como `completed`. O banco de restore foi preservado e não substitui o banco da aplicação. O backup e as chaves continuam nesta VPS; cópia fora do servidor e agendamento de backups não foram configurados nesta implantação.

O ensaio de rollback usou a mesma imagem sob duas tags, verificando o mecanismo de reversão da especificação do serviço e recuperação dos processos. Não é prova de compatibilidade de um binário antigo com schema novo nem de downgrade de banco. Consulte [prontidão](production-readiness.md) antes de uma atualização com migrações.

APIs reais, credenciais de fornecedores, agente lançado e entrega RCS continuam para depois, conforme decisão do titular. PDF e operações opcionais sem contrato implementado continuam bloqueados. A implantação não altera essas restrições.
