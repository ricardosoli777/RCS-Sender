# Prontidão e deployment

A construção está concluída e a aplicação foi implantada em https://rcssender.arkitekt.space. A CI passou com PostgreSQL 17/Redis 7; HTTPS público e da origem, sessão, isolamento, avanço de jornada pelo worker, backup/restauração e rollback do serviço foram verificados. Consulte [validação](validation.md) e [evidências da VPS](deployment-arkitekt.md). Não houve ativação de fornecedor ou envio RCS real.

Na VPS Arkitekt, use a [stack Swarm](vps-arkitekt.md): bancos privados, API/web em loopback dentro da tarefa da aplicação e Caddy interno atrás do Traefik existente. Não há novas portas publicadas. O procedimento compose abaixo é uma alternativa para uma VPS dedicada sem o proxy existente; não execute uma segunda instalação sobre a stack publicada.

Use cópia privada de `.env.example` com `NODE_ENV=production`, domínio HTTPS, URLs locais, senhas, dois segredos de proxy distintos e chaves de cifra independentes. Acrescente `RCS_ENV_FILE` absoluto, `RCS_DOMAIN`, `RCS_IMAGE` com tag imutável, `POSTGRES_PASSWORD` e `REDIS_PASSWORD`. Preserve permissão 600; não versione o arquivo nem imprima configuração com segredos.

No servidor escolhido:

1. Instale com Node 24 e pnpm 10.30.3, lockfile congelado; execute os checks de [validação](validation.md).
2. Valide `docker compose --env-file /CAMINHO/rcs.env -f ops/compose.yaml config --quiet`.
3. Construa com `docker compose --env-file /CAMINHO/rcs.env -f ops/compose.yaml build migrate`.
4. Configure DNS/firewall, revise backup e execute `docker compose --env-file /CAMINHO/rcs.env -f ops/compose.yaml up -d`. Migração deve terminar antes de API/worker.
5. Confira HTTPS, login/CSRF, proxies, sessões, isolamento, heartbeat e filas; repita E2E e ensaio de restore.
6. Configure e valide cada fornecedor conforme sua [documentação de integração](providers/README.md), antes de ativar agentes ou enviar.

Controles de despacho, grants de mídia, orçamento compartilhado, callbacks para reconciliação e manutenção manual de histórico estão implementados. Consulta remota individual e PDF não são declarados suportados. Retenção não é automática; determine política operacional e monitore crescimento do banco.

Resultados externos incertos nunca são repetidos automaticamente. Testes locais não atestam consentimento de leads, agente lançado, quota contratada, entrega real ou throughput de produção. Essas provas dependem das contas e do ambiente de operação.

Antes de atualizar, pare o worker e faça backup verificado. Preserve imagem anterior e chaves antigas. Rollback de aplicação exige compatibilidade com o schema; caso contrário restaure em banco novo e revise a conexão. Não remova volumes para rollback. Veja [operação](operations.md) e [manutenção](history-maintenance.md).
