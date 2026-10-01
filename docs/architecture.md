# Arquitetura

O RCS Sender será um monólito modular em um monorepo pnpm. `apps/web` apresenta a interface, `apps/api` expõe HTTP e `apps/worker` processa tarefas. O backend usa PostgreSQL para persistência e Redis com BullMQ para filas. O domínio de mensagens e campanhas não conhece payloads dos provedores; os adaptadores traduzem contratos canônicos.

Nesta primeira etapa, apenas a estrutura, configuração, logs e health checks foram criados. Os módulos de domínio, repositórios, migrações e adaptadores serão acrescentados nas waves definidas em `MASTER-SPEC.yaml`.

