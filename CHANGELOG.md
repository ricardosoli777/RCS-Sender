# Changelog

## Em desenvolvimento — Fundação 5.3.0

- Wave 5: contratos canônicos, matriz de capacidades, registro com requisitos de ativação e framework de evidência de provedores.
- Conexões isoladas por workspace, credenciais criptografadas e auditoria transacional; API sem leitura de segredos.
- Wave 5 concluída na CI de 03/10/2026: 47 testes e dois E2E passaram, incluindo troca de ciphertext, rotação de chaves e autorização revalidada.
- Wave 4: tokens Purple Signal, fontes locais, AppShell responsivo e navegação que preserva o workspace.
- Configurações com gestão real de membros, alteração de perfis e confirmação de remoção; autorização mantida na API.
- Wave 4 concluída na CI de 03/10/2026: 37 testes e dois E2E passaram; capturas desktop/celular inspecionadas, incluindo foco do diálogo e ações móveis.
- Wave 3: CSP com nonces por requisição e limites Redis por IP autenticado na cadeia proxy público → web → API, com segredos distintos.
- CI da Wave 3 aprovada em 03/10/2026: 37 testes e dois cenários E2E, incluindo injeção no HTML e limites independentes com Redis real.
- Wave 3: cabeçalhos de segurança web, prazo para uploads no proxy, cancelamento por desconexão e ocultação de segredos/cookies nos logs.
- Tipos do Node.js declarados na raiz e no projeto E2E, corrigindo a falha da CI em instalações limpas.
- Conversão explícita de UUID na auditoria de criação de workspace, corrigindo o cadastro com PostgreSQL real.
- Servidor E2E usa nível de log aceito pela configuração tipada da API.
- Master Spec 5.3.0 validado como YAML, com arquitetura por workspaces.
- Cadastro transacional cria usuário, workspace padrão, vínculo de proprietário e sessão.
- Login/logout, cookies HttpOnly, expiração absoluta de oito horas e tokens persistidos somente como hash.
- Perfis associados ao workspace, autorização explícita e negação por padrão no servidor.
- Seletor de workspace e API de gestão de membros com proteção do último proprietário ativo.
- Auditoria operacional isolada por workspace; histórico inicial preservado em log de identidade separado.
- CSRF por origem e cabeçalho, payloads estritos, limite de login/cadastro e falha fechada de Redis.
- Proxy web com rotas aprovadas e corpo limitado; carregamento do `.env` no servidor web.
- Waves 1 e 2 validadas na CI em 03/10/2026: 29 testes com PostgreSQL/Redis e fluxo E2E no Chromium passaram.
- Documentação de autenticação, workspaces, configuração e validação atualizada.

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
- Migração inicial de usuários, sessões e auditoria; hash de senhas com `scrypt`.
