# Manutenção do histórico e das chaves

A tela Operação oferece duas rotinas exclusivas do proprietário, com origem/CSRF, workspace e perfil revalidados em transação. As migrações 031 e seguintes preservam os guardas de imutabilidade, autorizando somente alterações exatas de ciphertext realizadas pela manutenção do servidor.

## Rotação

Configure a nova chave como ativa e mantenha as antigas no keyring. `POST /workspaces/:workspaceId/operations/rotate-cipher` com `{}` processa até 100 registros de cada tabela por lote. Repita enquanto `remaining` for maior que zero. Cada lote descriptografa, recifra e verifica a igualdade do plaintext antes de confirmar a auditoria.

Credenciais preservam sua identidade lógica e revisão durante recifragem, evitando invalidar checks e despachos existentes. A troca de valores das credenciais continua invalidando a revisão. Ciphertext não pode migrar para outra conexão/workspace. A chave antiga só pode sair do ambiente depois de concluir todos os workspaces e considerar backups ainda cifrados com ela.

## Compactação

`POST /workspaces/:workspaceId/operations/compact-history` recebe `retainDays` entre 30 e 3650; padrão 365. A interface exige confirmação da remoção dos corpos brutos. Até 100 receipts completed/discarded antigos têm somente o corpo cifrado removido. Deduplicação, identidade, estado, eventos normalizados, versões, tentativas e auditoria permanecem. Pending/dead nunca são compactados. Grants de mídia vencidos são removidos; assets privados permanecem.

Não existe agendamento automático nem política de apagar todo o histórico. A operação registra contagens e política na auditoria, sem payloads ou segredos. Falha de autorização, cifra ou auditoria desfaz o lote.
