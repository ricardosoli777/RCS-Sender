# Configuração

Copie `.env.example` para `.env` na raiz. O `.env` não deve ser commitado.

| Variável | Uso |
| --- | --- |
| `NODE_ENV` | Ambiente de execução. |
| `API_PORT` | Porta local da API. |
| `APP_URL` | Origem HTTP(S) da interface, sem caminho. Deve corresponder à origem usada no navegador; exige HTTPS em produção. |
| `API_URL` | Origem HTTP(S) da API, sem caminho. Usada também pelo servidor web e nunca publicada como variável `NEXT_PUBLIC_*`. |
| `DATABASE_URL` | Conexão PostgreSQL de desenvolvimento. |
| `REDIS_URL` | Conexão Redis de desenvolvimento. |
| `LOG_LEVEL` | Nível dos logs. |

A API e o worker falham na inicialização quando faltam variáveis obrigatórias. `pnpm dev` e o comando `start` do web carregam o `.env` da raiz; os endpoints web usam `API_URL` em tempo de execução. Endereços de produção, webhooks e credenciais de provedores serão configurados nas respectivas waves.

Sessões têm duração absoluta de oito horas, sem renovação automática. O cookie usa `HttpOnly`, `SameSite=Strict` e `Path=/`; em produção, usa também `Secure` e o prefixo `__Host-`. A API pode permanecer em HTTP no loopback atrás do servidor web; a origem pública da interface precisa de HTTPS.

`RUN_SERVICE_TESTS=1` habilita testes com serviços reais. Esses testes precisam de PostgreSQL e Redis exclusivos para teste. Consulte [validação](validation.md); nunca use banco ou Redis de produção.
