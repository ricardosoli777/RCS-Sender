# Construção local até a Wave 29

Fonte: MASTER-SPEC 6.0.0. Construção local concluída; aceitação externa e deployment são etapas de operação posteriores, conforme instrução do usuário.

| Wave | Entrega local concluída |
| --- | --- |
| 0–7 | Fundação, autenticação, workspaces, segurança, Provider Core, mock e Google documentado |
| 8–14 | Contatos, consentimento/elegibilidade, mídia privada, mensagens/categorias/carrosséis e campanhas |
| 15 | Despacho durável, preparação/confirmação, agenda, controles, cadência, limites compartilhados e acompanhamento |
| 16 | Callbacks autenticados, cifra, dedup, backoff com jitter e recuperação |
| 17–20 | Jornadas/versionamento, entradas, participações, esperas, condições e múltiplas ações/mensagens |
| 21 | Pontuação, regras, histórico e classificação |
| 22 | Canvas, conexões, edição, autosave, publicação e seletores; Chromium aprovado |
| 23–24 | Analytics de funil e Inbox com atribuição/resposta preparada |
| 25 | Cinco adaptadores documentados, formatos avançados e elegibilidade onde implementada |
| 26–27 | Analytics/auditoria, heartbeat, falhas e recuperação auditada |
| 28 | Isolamento, processos nativos independentes, recuperação, rotação/compactação, backup e restore |
| 29 | Documentação, compose/Caddy, scripts, release check e instalação isolada com build |

443 testes passaram, nove verificações de domínio nativo e sete E2E Chromium passaram na CI. Instalação isolada com lockfile congelado e backup/restore com 34 migrações passaram. A VPS foi publicada com HTTPS, smoke, worker, restore em banco novo e rollback do serviço; ver docs/deployment-arkitekt.md.

Pendências externas: credenciais e ativação de agentes e prova de entrega, reservadas para depois. Commit, push e publicação na VPS realizados conforme autorização. Sem chamadas reais a fornecedores.

Limites deliberados: PDF, elegibilidade sem endpoint documentado e operações opcionais não implementadas permanecem bloqueados. Retenção manual limitada preserva eventos/versões/auditoria; resultado incerto nunca autoriza reenvio automático. Ver docs/validation.md e docs/production-readiness.md.
