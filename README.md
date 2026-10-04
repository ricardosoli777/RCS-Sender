![Banner RCS Sender](docs/assets/readme-banner.png)

# RCS Sender

Plataforma de mensagens, campanhas e funis RCS independente de fornecedores, conforme [MASTER-SPEC 6.0.0](MASTER-SPEC.yaml). Construção local das waves concluída; configuração das contas e uso das APIs reais ficam para depois. Nenhum envio RCS real ou deployment externo foi realizado.

O sistema inclui contatos e consentimentos, mensagens versionadas com categorias, texto/cards/carrosséis/imagens, campanhas com preparação e confirmação, filas duráveis, cadenciamento e controles. Jornadas permitem várias mensagens conforme o lead avança, esperas por tempo ou evento, condições, escolha de caminho por resposta, tags, pontuação, metas e webhooks. O editor visual tem autosave e publicação imutável.

Google RBM, Infobip, Twilio, Sinch e Zenvia têm adaptadores construídos conforme seus contratos documentados, com testes locais e capacidades explícitas. Aparecem desativados até configuração e evidência específica de ativação. Capacidade desconhecida bloqueia a operação; PDF e operações opcionais sem contrato implementado permanecem não suportados. Consulte [provedores](docs/providers/README.md).

Analytics, Inbox Lite, auditoria, heartbeat e recuperação de consumidores completam a operação. Mídia privada usa acesso temporário vinculado ao envio; credenciais e eventos são cifrados. Proprietários podem executar [rotação de chaves e compactação limitada](docs/history-maintenance.md).

## Início rápido

Use Node 24, pnpm 10.30.3 e instâncias de desenvolvimento de PostgreSQL e Redis. Docker não é obrigatório para desenvolver.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Edite o arquivo privado com as URLs e chaves do ambiente. Nunca versione credenciais.

```powershell
pnpm build
pnpm db:migrate
pnpm dev
```

Abra http://localhost:3000 e crie uma conta; o cadastro cria seu workspace. A API fica em http://localhost:3001. Consulte [desenvolvimento local](docs/local-development.md) e [configuração](docs/configuration.md).

## Verificação e operação

Build, tipos, lint, testes, Chromium, instalação isolada com lockfile congelado e backup/restauração nativos foram executados. Resultados e limites estão em [validação](docs/validation.md). A CI está configurada para repetir testes com PostgreSQL 17/Redis 7; sua configuração não constitui resultado remoto desta revisão.

Artefatos Linux de instalação, Caddy e backup estão em `ops/`. Consulte [operação](docs/operations.md) e [prontidão](docs/production-readiness.md). VPS, DNS, HTTPS público, ativação dos fornecedores e entrega real exigem validação no ambiente correspondente.

Documentação: [arquitetura](docs/architecture.md), [mensagens](docs/messages.md), [campanhas](docs/campaigns.md), [funis](docs/journeys.md), [elegibilidade](docs/eligibility.md), [mídia](docs/media.md) e [workspaces](docs/workspaces.md).

## Estrutura

```text
apps/web       interface Next.js
apps/api       API Fastify
apps/worker    processamento BullMQ
packages/      domínio e contratos compartilhados
docs/          documentação
ops/           instalação e manutenção
```

Consulte [SECURITY.md](SECURITY.md) e a [licença própria](LICENSE.md). Contribuições que alterem o produto dependem de autorização expressa do titular.
