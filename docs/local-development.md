# Desenvolvimento local

## 1. Ferramentas

Instale Git, Node.js LTS e pnpm. Confira no PowerShell:

```powershell
git --version
node --version
pnpm --version
```

Cada comando deve imprimir uma versão. Docker não é necessário.

## 2. Serviços de desenvolvimento

Tenha uma instância PostgreSQL e uma Redis acessíveis ao computador. Use contas e dados de desenvolvimento. A aplicação ainda não cria o banco automaticamente.

## 3. Instalação

Na pasta do projeto:

```powershell
pnpm install
Copy-Item .env.example .env
```

Preencha `DATABASE_URL` e `REDIS_URL` em `.env`. Execute:

```powershell
pnpm build
pnpm dev
```

Abra `http://localhost:3000`. Consulte `/health/ready` na API para confirmar a ligação com os dois serviços. Resposta 503 indica indisponibilidade de pelo menos um deles. Se a inicialização reclamar de configuração ausente, confira `.env` e seus caminhos; não cole a senha em issues ou logs.

A CI usa instâncias temporárias de PostgreSQL e Redis para testar a prontidão da API. Isso valida a integração básica sem instalar Docker na máquina de desenvolvimento. Para executar o mesmo teste localmente, configure os serviços no `.env` e rode `RUN_SERVICE_TESTS=1 pnpm test` em um shell compatível; no PowerShell, use `$env:RUN_SERVICE_TESTS='1'; pnpm test`.
