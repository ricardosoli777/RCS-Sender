# Arquitetura

O RCS Sender será um monólito modular em um monorepo pnpm. `apps/web` apresenta a interface, `apps/api` expõe HTTP e `apps/worker` processa tarefas. O backend usa PostgreSQL para persistência e Redis com BullMQ para filas. O domínio de mensagens e campanhas não conhece payloads dos provedores; os adaptadores traduzem contratos canônicos.

Nesta primeira etapa, apenas a estrutura, configuração, logs e health checks foram criados. Os módulos de domínio, repositórios, migrações e adaptadores serão acrescentados nas waves definidas em `MASTER-SPEC.yaml`.

O pacote `@rcs/security` fornece criptografia autenticada AES-256-GCM para credenciais futuras. O texto cifrado inclui versão da chave, nonce e tag; o contexto da conexão é autenticado junto com o conteúdo. A persistência e a rotação operacional das chaves ainda não estão integradas à API.
