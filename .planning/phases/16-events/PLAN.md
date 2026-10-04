# Wave 16 — Webhooks e eventos

Contrato: resolver conexão e workspace pelo vínculo persistido, verificar assinatura pelo adaptador, preservar corpo bruto criptografado, deduplicar receipts e eventos, processar fora da requisição e persistir consumo idempotente por consumidor/workspace. Não registrar adaptadores de produção automaticamente.

Implementação: migração 017; EventIngress/EventBus no pacote compartilhado; rota Fastify dedicada com corpo bruto limitado e exclusão de CSRF somente nessa rota; relay/consumidor worker com SQL como fonte. Eventos sem assinatura ou identidade divergente não entram. API de consulta apresenta metadados sem payloads sensíveis.

Verificação: testes SQL e HTTP com fixtures, replay, assinatura inválida, isolamento, rotação/estado de conexão, falhas de auditoria, orçamento e recovery. Não alegar prova real dos fornecedores nem concorrência PostgreSQL nativa.
