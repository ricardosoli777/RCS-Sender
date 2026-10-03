# Provider Core

A Wave 5 cria o pacote `@rcs/providers`, os contratos canônicos e a persistência das conexões. Nenhum adaptador externo está registrado no processo de produção. O catálogo inicial é vazio. Os testes usam fixtures locais sem rede; seus registros de evidência sintéticos não representam validação de Google, Infobip, Twilio, Sinch ou Zenvia.

`RcsProvider` define metadados, capacidades, limites, agentes, envio canônico, estado da conexão, saúde e verificação/parsing/normalização de webhooks. Operações opcionais só podem ser declaradas suportadas quando implementadas. `ProviderRegistry` impede IDs duplicados e bloqueia resolução até que documentação, evidência, testes de contrato, conexão, credenciais e webhooks estejam marcados como verificados na configuração do adaptador. Esses registros são definidos no servidor, nunca recebidos do cliente. As flags não substituem revisão dos documentos e relatórios reais.

`CapabilityMatrix` distingue suporte verificado, ausência de suporte e informação desconhecida. Desconhecido bloqueia o uso. `validateMessage` verifica o formato, limites de texto em pontos de código Unicode, cards, mídia e sugestões. Cada adaptador deve traduzir seus limites documentados para essa representação e validar particularidades adicionais. Mídia usa IDs de assets; resolução de URLs e ownership fica para o Media Service. O futuro Campaign Engine deverá validar capacidades antes de enfileirar.

`CanonicalEvent` inclui workspace, conexão, provedor e os eventos previstos na especificação. `CanonicalError` usa códigos e mensagens fixas, sem incluir respostas brutas dos fornecedores. Apenas erros explicitamente transitórios permitem repetição. Autenticação e assinaturas de webhook continuam específicas de cada adaptador; não existe verificação genérica de assinatura.

## Conexões e credenciais

Conexões pertencem a um workspace. Credenciais usam chave estrangeira composta `(workspace_id, connection_id)`, impedindo associar a credencial de um workspace à conexão de outro. AES-256-GCM usa como dados autenticados workspace, conexão, provedor e ambiente, impedindo reutilizar ciphertext em outro contexto. As operações revalidam o vínculo ativo e o perfil proprietário/administrador dentro da transação, usando o mesmo lock das alterações de membros. Criação e substituição de credenciais incluem auditoria atômica; falha da auditoria desfaz toda a alteração.

Uma conexão nova tem estado `unverified` e gera `provider.connection_created`. `provider.connected` fica reservado à verificação bem-sucedida que será implementada com os adaptadores. Atualizar credenciais retorna o estado para `unverified`. A API nunca oferece leitura de plaintext ou ciphertext; acesso descriptografado é um método interno para execução do provedor.

| Rota | Operação |
| --- | --- |
| `GET /workspaces/:workspaceId/providers/catalog` | Descritores públicos dos adaptadores registrados, sem valores de credenciais. |
| `GET /workspaces/:workspaceId/providers` | Metadados das conexões do workspace. |
| `POST /workspaces/:workspaceId/providers` | Cria conexão não verificada com `providerId`, `name`, `environment` e `credentials`. |
| `PUT /workspaces/:workspaceId/providers/:connectionId/credentials` | Substitui credenciais segundo o schema do adaptador. |

Todas exigem `providers.manage`; mutações exigem origem válida e `X-RCS-Request: 1`. A API aceita até 64 KiB nessas mutações e mantém schemas estritos. Sem adaptador ativado, a criação retorna 409. Sem chaves de criptografia configuradas, a persistência de credenciais falha fechada. A tela de Integrações permanece em preparação até a implementação dos adaptadores e de seu fluxo de conexão.

## Evidência de integração

Copie [TEMPLATE.md](TEMPLATE.md) quando iniciar um adaptador. Consulte primeiro a documentação oficial atual do fornecedor e registre dúvidas sem transformá-las em capacidades verificadas. Nenhum documento de fornecedor foi preenchido como concluído nesta etapa. O Mock Provider é a próxima wave e terá evidência explicitamente local, separada de integrações reais.

A implementação reutiliza o cipher já existente, seguindo os dados autenticados de [Node.js crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#ciphersetaadbuffer-options) e as relações compostas documentadas em [PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK).
