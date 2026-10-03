# Segurança

Não registre credenciais, tokens, senhas ou chaves no repositório. Use `.env` apenas no ambiente local; o arquivo está no `.gitignore`. Credenciais de provedores não deverão ficar em variáveis do frontend nem em texto claro no banco.

Cadastro, login, sessões e autorização por workspace foram validados com PostgreSQL, Redis e Chromium na [CI de 03/10/2026](https://github.com/ricardosoli777/RCS-Sender/actions/runs/37126723421). A plataforma permanece em desenvolvimento e **não está pronta para produção**: proteção de proxy público e as waves de segurança e implantação ainda precisam ser validadas.

O pacote `@rcs/security` cifra dados com AES-256-GCM e suporta versões de chave. A persistência de credenciais de provedores usa esse cipher; `RCS_CREDENTIAL_KEYS` e `RCS_CREDENTIAL_ACTIVE_KEY` são configuradas fora do Git. Sem chaves configuradas, gravações de credenciais falham fechadas. A recriptografia em lote não é automática; mantenha chaves antigas até verificar a migração de todos os ciphertexts.

Senhas usam `scrypt` com sal aleatório; tokens de sessão têm 32 bytes aleatórios e somente seu SHA-256 é persistido. Sessões expiram após oito horas, são revogadas no logout e deixam de funcionar quando a conta é desativada. Cookies são HttpOnly e SameSite Strict; produção exige HTTPS na interface e cookie Secure com prefixo `__Host-`.

O cadastro cria usuário, workspace padrão, vínculo `owner`, sessão e eventos na mesma transação. A API valida conta, sessão, workspace ativo, membership ativo e permissão no servidor. Rotas sem autorização declarada negam acesso. Workspaces sem vínculo válido retornam 404; vínculo válido sem permissão retorna 403. Alterações de membros revalidam o proprietário dentro da transação e preservam ao menos um proprietário ativo.

Auditoria operacional contém workspace obrigatório e nunca é consultada globalmente em fluxos de usuário. Apenas `owner` possui `audit.view` e `members.manage`, conforme a spec. Eventos de identidade ficam em `auth_audit_logs`, sem senhas ou tokens e sem endpoint público de consulta. Eventos anteriores são preservados pela migração.

Mutações exigem origem exatamente igual a `APP_URL` e cabeçalho `X-RCS-Request: 1`, inclusive login e cadastro. A API não concede CORS para origens externas. Esses controles complementam SameSite. O proxy web preserva a origem recebida, aceita somente rotas aprovadas e limita corpos a 8 KiB, com limite de 64 KiB nas rotas específicas de conexões/credenciais de provedores.

O proxy aplica prazo de dez segundos desde a leitura do corpo até a comunicação com a API e cancela a leitura quando o cliente desconecta. Erros e rejeições do proxy recebem `Cache-Control: no-store`. Esses controles não substituem os limites de conexão do proxy público.

A interface web aplica `nosniff`, bloqueio de frames, ausência de referrer e bloqueio de câmera, microfone e geolocalização. A CSP usa nonce de 32 bytes aleatórios gerado no servidor a cada requisição, com `strict-dynamic` para scripts e sem `unsafe-inline` ou `unsafe-eval` em produção. O Next.js recebe o nonce pelo cabeçalho de requisição e as páginas são renderizadas dinamicamente, sem cache de HTML. Scripts inseridos no HTML sem nonce são bloqueados; `strict-dynamic` permite carregamentos iniciados por scripts já confiáveis. A implementação segue o [guia oficial de CSP do Next.js](https://nextjs.org/docs/app/guides/content-security-policy). Em desenvolvimento, eval para scripts e estilos inline são permitidos para as ferramentas locais.

Logs ocultam campos de senha, token, chave, segredo e credenciais no nível principal e nos objetos imediatamente aninhados, além de Authorization, Cookie e Set-Cookie nos campos HTTP previstos. A ocultação segue os caminhos explícitos do [Pino](https://github.com/pinojs/pino/blob/main/docs/redaction.md); não protege segredos dentro de mensagens livres ou estruturas arbitrárias. Não registre payloads nem credenciais nessas formas.

A API aplica Helmet, corpo máximo global de 1 MiB e limite de requisições no Redis. Login e cadastro têm limite de cinco requisições por minuto; falha do Redis bloqueia o acesso. Health checks ficam fora dos limites e da autenticação. A API escuta em `127.0.0.1`.

Em produção, a interface exige um proxy público autenticado: ele sobrescreve `X-RCS-Client-IP` com o IP da conexão e injeta `X-RCS-Edge-Token` fora do navegador. A interface valida esse segredo e encaminha apenas um IP válido para a API com um segundo segredo, `X-RCS-Proxy-Token`. A API aceita o IP encaminhado somente pelo loopback com o segredo correto. Cabeçalhos comuns recebidos do cliente são ignorados; listas de IPs e endereços com escopo são rejeitados. O limitador usa seu agrupamento padrão de IPv6 por /64. Desenvolvimento sem segredos mantém limites compartilhados pelo loopback. A instalação real do proxy na VPS ainda precisa de validação; veja [configuração](docs/configuration.md).

Consulte [workspaces](docs/workspaces.md) e [validação](docs/validation.md).

Conexões e credenciais de provedores pertencem ao workspace. A chave estrangeira composta impede vincular credenciais a uma conexão de outro workspace; o contexto autenticado da criptografia inclui workspace, conexão, provedor e ambiente. Alterações revalidam permissões dentro da transação e fazem rollback se a auditoria falhar. Apenas proprietários e administradores têm `providers.manage`; a API retorna metadados e nunca fornece leitura de plaintext ou ciphertext. O catálogo de produção ainda não tem adaptadores ativados. Veja [Provider Core](docs/providers/README.md).

Para relatar uma vulnerabilidade, use um canal privado com o mantenedor do repositório; não publique segredos ou detalhes exploráveis em uma issue pública.
