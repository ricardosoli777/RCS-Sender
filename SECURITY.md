# Segurança

Não registre credenciais, tokens, senhas ou chaves no repositório. Use `.env` apenas no ambiente local; o arquivo está no `.gitignore`. Credenciais de provedores não deverão ficar em variáveis do frontend nem em texto claro no banco.

Cadastro, login, sessões e autorização por workspace foram validados com PostgreSQL, Redis e Chromium na [CI de 03/10/2026](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37126723421). A plataforma permanece em desenvolvimento e **não está pronta para produção**: proteção de proxy público e as waves de segurança e implantação ainda precisam ser validadas.

O pacote `@rcs/security` cifra dados com AES-256-GCM e suporta versões de chave para rotação futura. A aplicação ainda não armazena credenciais de provedores. A chave mestra deverá ser configurada fora do Git quando o armazenamento for implementado.

Senhas usam `scrypt` com sal aleatório; tokens de sessão têm 32 bytes aleatórios e somente seu SHA-256 é persistido. Sessões expiram após oito horas, são revogadas no logout e deixam de funcionar quando a conta é desativada. Cookies são HttpOnly e SameSite Strict; produção exige HTTPS na interface e cookie Secure com prefixo `__Host-`.

O cadastro cria usuário, workspace padrão, vínculo `owner`, sessão e eventos na mesma transação. A API valida conta, sessão, workspace ativo, membership ativo e permissão no servidor. Rotas sem autorização declarada negam acesso. Workspaces sem vínculo válido retornam 404; vínculo válido sem permissão retorna 403. Alterações de membros revalidam o proprietário dentro da transação e preservam ao menos um proprietário ativo.

Auditoria operacional contém workspace obrigatório e nunca é consultada globalmente em fluxos de usuário. Apenas `owner` possui `audit.view` e `members.manage`, conforme a spec. Eventos de identidade ficam em `auth_audit_logs`, sem senhas ou tokens e sem endpoint público de consulta. Eventos anteriores são preservados pela migração.

Mutações exigem origem exatamente igual a `APP_URL` e cabeçalho `X-RCS-Request: 1`, inclusive login e cadastro. A API não concede CORS para origens externas. Esses controles complementam SameSite. O proxy web preserva a origem recebida, aceita somente rotas aprovadas e limita corpos a 8 KiB.

O proxy aplica prazo de dez segundos desde a leitura do corpo até a comunicação com a API e cancela a leitura quando o cliente desconecta. Erros e rejeições do proxy recebem `Cache-Control: no-store`. Esses controles não substituem os limites de conexão do proxy público.

A interface web aplica `nosniff`, bloqueio de frames, ausência de referrer e bloqueio de câmera, microfone e geolocalização. A CSP inicial restringe base URI, envio de formulários, frames e objetos; uma política de scripts com nonces ainda será implementada. A configuração usa o mecanismo oficial de [cabeçalhos do Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers).

Logs ocultam campos de senha, token, chave, segredo e credenciais no nível principal e nos objetos imediatamente aninhados, além de Authorization, Cookie e Set-Cookie nos campos HTTP previstos. A ocultação segue os caminhos explícitos do [Pino](https://github.com/pinojs/pino/blob/main/docs/redaction.md); não protege segredos dentro de mensagens livres ou estruturas arbitrárias. Não registre payloads nem credenciais nessas formas.

A API aplica Helmet, corpo máximo global de 1 MiB e limite de requisições no Redis. Login e cadastro têm limite de cinco requisições por minuto; falha do Redis bloqueia o acesso. Health checks ficam fora dos limites e da autenticação. A API escuta em `127.0.0.1`. Nesta fundação, solicitações pelo proxy web compartilham o IP de loopback para limites; a configuração de proxy confiável e limites de produção será validada antes de exposição pública.

Consulte [workspaces](docs/workspaces.md) e [validação](docs/validation.md).

Para relatar uma vulnerabilidade, use um canal privado com o mantenedor do repositório; não publique segredos ou detalhes exploráveis em uma issue pública.
