![Banner RCS Sender em tons de roxo, com ondas de sinal e balões de mensagem](docs/assets/readme-banner.png)

# RCS Sender

Plataforma de mensagens e campanhas RCS independente de provedores. O projeto está na fase de fundação: **ainda não envia campanhas nem está pronto para produção**. A especificação completa está em [MASTER-SPEC.yaml](MASTER-SPEC.yaml).

## O que já existe

- Monorepo com aplicação web, API e worker.
- Configuração tipada que exige PostgreSQL e Redis antes de iniciar API e worker.
- Logs estruturados com campos sensíveis ocultos.
- Endpoints `/health/live` e `/health/ready` na API.
- Página inicial provisória no tema Purple Signal.
- Regra de documentação oficial antes de qualquer integração externa, conforme a spec 5.2.0.

## Arquitetura resumida

O domínio terá mensagens e eventos em formatos próprios. Adaptadores converterão esses formatos para cada provedor RCS. A API recebe comandos; o worker processa tarefas assíncronas; PostgreSQL guarda os dados; Redis sustenta a fila BullMQ. Veja [docs/architecture.md](docs/architecture.md).

## Tecnologias

Node.js, TypeScript, pnpm, Next.js, Fastify, PostgreSQL, Redis, BullMQ, Zod e Pino. O desenvolvimento local **não exige Docker**.

## Requisitos e início rápido

Instale Git, Node.js LTS e pnpm. Obtenha acesso a instâncias de desenvolvimento de PostgreSQL e Redis. Nenhuma credencial real deve ser enviada ao GitHub.

No PowerShell, na raiz do repositório:

```powershell
pnpm install
Copy-Item .env.example .env
```

Edite `.env` com URLs reais dos serviços de desenvolvimento. O arquivo é ignorado pelo Git. Em seguida:

```powershell
pnpm build
pnpm dev
```

Abra `http://localhost:3000`. Para verificar a API, acesse `http://localhost:3001/health/live` e `http://localhost:3001/health/ready`. O segundo responde 503 quando PostgreSQL ou Redis não estão disponíveis.

Para validar código e testes, rode `pnpm build`, `pnpm typecheck`, `pnpm lint` e `pnpm test`. O workflow de CI executa esses comandos no GitHub a cada push ou pull request.

**Estado desta wave:** não há migrações de banco nem configuração de provedor ainda. Esses passos serão incluídos quando os respectivos módulos forem implementados. Não trate a página inicial como painel funcional.

## Configuração e instalação

Veja [desenvolvimento local](docs/local-development.md) e [configuração](docs/configuration.md). A instalação na VPS, domínio, HTTPS, processos, backup e atualizações serão documentados e validados nas waves de implantação. O código não contém domínio ou URL pública de webhook fixos.

## Estrutura

```text
apps/web       interface Next.js
apps/api       API HTTP
apps/worker    processamento assíncrono
packages/      código compartilhado
docs/          documentação operacional e de arquitetura
```

## Segurança e contribuições

Consulte [SECURITY.md](SECURITY.md) antes de relatar vulnerabilidades ou lidar com segredos. Contribuições que alterem o produto dependem de autorização expressa do titular. A [licença própria](LICENSE.md) permite cópias integrais gratuitas e proíbe alterações e venda do produto.
