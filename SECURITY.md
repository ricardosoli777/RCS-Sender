# Segurança

Não registre credenciais, tokens, senhas ou chaves no repositório. Use `.env` apenas no ambiente local; o arquivo está no `.gitignore`. Credenciais de provedores não deverão ficar em variáveis do frontend nem em texto claro no banco.

Esta versão é uma fundação em desenvolvimento, sem autenticação nem autorização implementadas. Não exponha API ou worker à internet ou a usuários reais antes da Wave 2 de segurança e das verificações de produção.

O pacote `@rcs/security` cifra dados com AES-256-GCM e suporta versões de chave para rotação futura. A aplicação ainda não armazena credenciais de provedores. A chave mestra deverá ser configurada fora do Git quando o armazenamento for implementado.

Para relatar uma vulnerabilidade, use um canal privado com o mantenedor do repositório; não publique segredos ou detalhes exploráveis em uma issue pública.
