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
pnpm db:migrate
pnpm dev
```

Abra `http://localhost:3000`, clique em **Criar uma conta** e informe seu nome, e-mail, senha e nome do workspace. A conta recebe um vínculo de proprietário nesse workspace. Não existe senha padrão nem comando de administrador global.

Consulte `/health/ready` na API para confirmar a ligação com os dois serviços. Resposta 503 indica indisponibilidade de pelo menos um deles. Se a inicialização reclamar de configuração ausente, confira `.env` e seus caminhos; não cole a senha em issues ou logs. Use a mesma origem em `APP_URL` e no navegador: `localhost` e `127.0.0.1` são origens diferentes.

A CI configura PostgreSQL e Redis temporários e está preparada para executar migrações, autenticação, isolamento e testes completos no Chromium. A execução dessa CI ainda precisa ser confirmada para esta implementação. Para rodar os testes com serviços locais de teste, siga [validação](validation.md), que mostra como carregar as variáveis do `.env` no PowerShell.
