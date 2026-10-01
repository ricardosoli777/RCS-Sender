# Configuração

Copie `.env.example` para `.env` na raiz. O `.env` não deve ser commitado.

| Variável | Uso |
| --- | --- |
| `NODE_ENV` | Ambiente de execução. |
| `API_PORT` | Porta local da API. |
| `APP_URL` | URL da interface neste ambiente. |
| `API_URL` | URL da API neste ambiente. |
| `DATABASE_URL` | Conexão PostgreSQL de desenvolvimento. |
| `REDIS_URL` | Conexão Redis de desenvolvimento. |
| `LOG_LEVEL` | Nível dos logs. |

A API e o worker falham na inicialização quando faltam variáveis obrigatórias. Endereços de produção, webhooks e credenciais de provedores serão configurados no ambiente adequado quando essas integrações forem implementadas.

