# Estado da construção

Objetivo autorizado: concluir as waves do MASTER-SPEC 6.0.0, fazer commit/push e publicar na VPS com Paramiko em rcssender.arkitekt.space. Construção e implantação concluídas. O usuário definiu APIs reais e credenciais para depois e pediu esquecer Mind Rica. Código e operação estão versionados; nenhum envio RCS real foi realizado.

Implementação local concluída até a Wave 29: campanhas/outbox/controles/cadência, eventos autenticados e cifrados, funis com várias mensagens e esperas, canvas/versionamento, entradas, respostas correlacionadas e caminhos, categorias, scoring, analytics, Inbox, webhooks, grants de mídia, elegibilidade Google/Infobip/Sinch, cinco adaptadores documentados, limites compartilhados, reconciliação por callbacks, manutenção e rotação de chaves. Migrações até 034; respostas antecipadas recuperadas e backoff com jitter.

Verificações em 04/10/2026:
- Suíte completa atual: 443 testes passaram na CI; duas provas Google e um teste multiprocesso reservado para o comando nativo foram pulados.
- Domínio nativo: nove verificações passaram, incluindo leitura/resposta antecipadas, seis processos concorrentes e exatamente um acionamento do adaptador local.
- Chromium: sete cenários E2E passaram, incluindo categoria, carrossel, seleção de caminho e preservação da versão ativa.
- Backup/restore nativos passaram em banco novo isolado. PostgreSQL 18 e Redis 8 foram provisionados em WSL exclusivamente para validação; compose de produção define PostgreSQL 17/Redis 7.
- Build, tipos, tipos E2E e lint passaram. Instalação isolada com 357 fontes, lockfile congelado e build passou. Release check e registros finais conferidos.

VPS: stack independente Swarm, PostgreSQL 17/Redis 7 privados, 34 migrações aplicadas, API/web/worker/Caddy saudáveis. HTTPS público e origem passaram; smoke público verificou sessão, CSRF, isolamento, revisão/categoria e jornada concluída. Backup restaurado em banco novo com contagens iguais. Rollback do serviço foi verificado com uma imagem de bytes idênticos; não prova downgrade de schema. Ver docs/deployment-arkitekt.md.

Limites externos restantes: credenciais de fornecedores, agente lançado e entrega RCS real. Esses pontos foram reservados pelo usuário para depois.

Nova autorização: liberar fornecedores para escolha e configuração pelo painel, melhorar orientações de campanhas/jornadas/imagens, adicionar favicon e botões de prévia clicáveis. Os cinco adaptadores agora permitem configuração, mantendo `connectionTestPassed=false`; salvar credenciais não envia nem testa automaticamente. Os quatro adaptadores fora Google ainda não confirmam acesso remoto no teste de conexão. Guias e limites em docs/como-usar.md e docs/providers/README.md.

Capacidades ausentes por contrato continuam desconhecidas ou não suportadas. Twilio/Zenvia não recebem elegibilidade inventada. PDF e operações opcionais sem implementação documentada ficam bloqueados; file está preparado no domínio/editor para imagens privadas, sem declarar suporte externo genérico. Retenção é manual, limitada a corpos brutos terminados e grants vencidos; eventos, tentativas, versões e auditoria ficam preservados. Consulta remota individual universal não existe; reconciliação usa retornos autenticados e IDs locais aceitos pelo fornecedor.

Não marcar o milestone como produção validada ou todas as provas externas concluídas. Os registros das waves distinguem construção local de aceitação externa.
