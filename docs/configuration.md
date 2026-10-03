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
| `RCS_EDGE_PROXY_SECRET` | Segredo hexadecimal de 64 caracteres do proxy público para a interface. Obrigatório em produção. |
| `RCS_API_PROXY_SECRET` | Segredo hexadecimal de 64 caracteres da interface para a API. Obrigatório em produção, distinto do segredo da borda. |

A API e o worker falham na inicialização quando faltam variáveis obrigatórias. `pnpm dev` e o comando `start` do web carregam o `.env` da raiz; os endpoints web usam `API_URL` em tempo de execução. Endereços de produção, webhooks e credenciais de provedores serão configurados nas respectivas waves.

Sessões têm duração absoluta de oito horas, sem renovação automática. O cookie usa `HttpOnly`, `SameSite=Strict` e `Path=/`; em produção, usa também `Secure` e o prefixo `__Host-`. A API pode permanecer em HTTP no loopback atrás do servidor web; a origem pública da interface precisa de HTTPS.

`RUN_SERVICE_TESTS=1` habilita testes com serviços reais. Esses testes precisam de PostgreSQL e Redis exclusivos para teste. Consulte [validação](validation.md); nunca use banco ou Redis de produção.

## Proxy público e limites por cliente

Gere cada segredo separadamente com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e guarde-os no ambiente dos processos. Se habilitar o modo de proxy em desenvolvimento, configure os dois valores. A API e a interface rejeitam configuração parcial; produção exige ambos. Reinicie os processos após uma rotação coordenada dos segredos.

O proxy público deve sobrescrever `X-RCS-Client-IP` com o IP da conexão e `X-RCS-Edge-Token` com o segredo privado. Não copie esses valores de cabeçalhos recebidos do navegador. Em uma instalação Nginx direta, use a diretiva oficial [proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header) na localização que encaminha ao Next.js:

```nginx
proxy_set_header X-RCS-Client-IP $remote_addr;
proxy_set_header X-RCS-Edge-Token "SUBSTITUA_PELO_RCS_EDGE_PROXY_SECRET";
```

Esse trecho é parte do contrato, não um guia completo de implantação. O Next.js deve escutar somente no loopback (`--hostname 127.0.0.1`) atrás do proxy público, assim como a API. Proteja o arquivo que contém o segredo. Se existir CDN ou outro proxy antes do Nginx, `$remote_addr` representa esse intermediário; não habilite confiança genérica em `X-Forwarded-For`. Essa cadeia adicional precisa de configuração e validação próprias.

A interface ignora o `X-Forwarded-For` recebido e envia o IP autenticado à API usando `RCS_API_PROXY_SECRET`. A API exige esse segredo e origem loopback para confiar no encaminhamento. IPs IPv6 compartilham limites por /64. Sem segredos, somente desenvolvimento/teste usa o limite compartilhado do loopback. A CI simula os cabeçalhos da borda com valores exclusivos de teste; validar Nginx, HTTPS e firewall na VPS continua pendente.
