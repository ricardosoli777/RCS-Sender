# Operação, backup e recuperação

O PostgreSQL é a fonte de estado; Redis transporta tarefas. Relays consultam intenções persistidas e recriam tarefas ausentes. Jobs contêm IDs, workspace e revisão/tentativa; conteúdo, telefone e credenciais não vão para a fila. O worker encerra relays, cancela operações pendentes e fecha filas/conexões ao receber SIGTERM.

O painel Operação requer `audit.view`, disponível ao proprietário. Mostra estados das filas, consumidores com falha, auditoria e heartbeat do worker. Um heartbeat saudável com menos de 30 segundos indica atividade do relay; não prova disponibilidade de fornecedor. O painel não expõe identidades de instâncias nem dados de outro workspace.

Receipts inválidos são descartados; indisponibilidade do normalizador aplica backoff e encerra após cinco tentativas. Consumidores mantêm efeito e marcador na mesma transação. Falhas são registradas sem mensagens privadas, aguardam 30 segundos e param após cinco tentativas. Reprocessar um consumidor exige proprietário atual, falha definitiva e auditoria na mesma transação. Esse comando não reenvia mensagens ou POSTs.

Para resultados `unknown`, preserve o ledger e investigue no fornecedor usando a referência da mensagem. Não apague tentativas para reenviar. Para ações de webhook interrompidas após reserva, a recuperação registra resultado incerto e não repete o POST. Uma falha de auditoria antes da reserva impede a chamada externa.

Em uma VPS Linux com Docker Compose, execute `bash ops/backup.sh /CAMINHO/rcs.env /CAMINHO/backups`. O script usa `pg_dump` em formato custom, verifica o catálogo com `pg_restore --list`, cria checksum e arquivos com permissão restrita. Agende backups e copie-os para armazenamento externo criptografado. Preserve separadamente as chaves antigas de `RCS_CREDENTIAL_KEYS`; banco restaurado sem essas chaves não permite ler históricos cifrados.

Faça o ensaio com `bash ops/restore-drill.sh /CAMINHO/rcs.env /CAMINHO/backup.dump rcs_restore_ensaio`. O script cria um banco novo com prefixo obrigatório, restaura numa transação e consulta tabelas críticas. Não aceita o nome de produção e não remove bancos. Compare contagens, chaves, versões imutáveis e amostras de eventos antes de considerar o backup aprovado. O teste WASM local é complementar; não substitui esse ensaio com PostgreSQL nativo.

Deploy: consulte [prontidão](production-readiness.md). Antes de atualizar, pare o worker, faça backup verificado e registre a imagem anterior. Use uma imagem imutável por release. Migrações são transacionais e aditivas. Rollback de aplicação usa a imagem anterior somente se ela for compatível com o schema; caso contrário restaure o backup num banco novo e revise a conexão. Nunca execute `docker compose down -v` para rollback.

Retenção e rotação: proprietários têm operações auditadas de rotação dos ciphertexts e compactação limitada de corpos brutos já terminados e grants vencidos. Eventos, tentativas, versões e auditoria são preservados. Veja [manutenção de histórico](history-maintenance.md). Não há compactação automática; defina política de exportação e monitore heartbeat, consumidores definitivos, resultados incertos e crescimento das filas.

O ensaio local com clientes nativos passou usando `bash ops/native-backup-drill.sh ENV_FILE BACKUP_DIRECTORY NEW_DATABASE`: dump custom, catálogo, checksum, restore transacional e comparação de contagens em banco novo. Isso complementa o script para Compose e não comprova VPS; veja [validação](validation.md).
