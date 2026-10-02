# Changelog

## 0.1.0 — Fundação inicial

- Especificação 5.2.0 consolidada em `MASTER-SPEC.yaml`.
- Monorepo inicial com web, API, worker, configuração e logs.
- Documentação inicial de instalação e segurança.
- Banner Purple Signal para o README e licença própria de cópia permitida.
- Pacote de criptografia autenticada e versionada para futuras credenciais de provedores.
- Cabeçalhos de segurança e limite global de requisições na API.
- Dependências fixadas em `pnpm-lock.yaml` para instalações reproduzíveis.
- `@fastify/rate-limit` atualizado para 11.2.0, corrigindo o bypass por rotação de IPv6.
- Teste de integração da prontidão com PostgreSQL e Redis temporários na CI.
