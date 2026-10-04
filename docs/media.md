# Media Service — Wave 10

Núcleo inicial de imagens privadas, implementado localmente em 03/10/2026. Os assets pertencem ao workspace e possuem IDs estáveis para o futuro domínio de mensagens. Nesta etapa não existe biblioteca visual de mídia nem envio dessas imagens aos fornecedores RCS.

| Rota | Operação |
| --- | --- |
| `POST /workspaces/:workspaceId/media` | Recebe `name`, `mimeType` e `dataBase64`; devolve metadados do asset. |
| `GET /workspaces/:workspaceId/media?offset=0` | Lista até 50 assets por página e o total do workspace. |
| `GET /workspaces/:workspaceId/media/:assetId/content` | Retorna os bytes reprocessados com sessão e permissão de leitura. |

Proprietários, administradores e operadores podem cadastrar; leitores consultam. Escrita usa `messages.manage`; leitura usa `messages.view`. Mutações exigem origem válida e `X-RCS-Request: 1`. O repositório revalida workspace, conta e vínculo ativos, inclusive após o processamento da imagem. Acesso entre workspaces retorna indisponível.

## Formatos e limites locais

PNG, JPEG e WebP estáticos, com até 2 MiB de entrada e de saída e dimensões de até 4096 × 4096 pixels. O JSON de upload aceita até 3 MiB para comportar base64. Esses são limites iniciais do app, não limites universais dos fornecedores. Não são aceitos SVG, GIF, animações, vídeos, PDFs, arquivos genéricos, caminhos locais nem URLs para importação. O nome é apenas um rótulo, nunca um caminho ou nome de download.

Base64 deve ser canônico. Assinatura do arquivo e formato declarado precisam coincidir. O processamento usa [Sharp](https://sharp.pixelplumbing.com/api-constructor/) com limites de pixels/canais e rejeição de dados inválidos. Todos os pixels são decodificados e reencodificados no mesmo formato. A orientação é aplicada e os [metadados originais são removidos](https://sharp.pixelplumbing.com/api-output/#keepmetadata). PNG com controle APNG e WebP com múltiplos quadros são rejeitados, evitando transformar uma animação silenciosamente em imagem estática.

Há até dois uploads em processamento por instância da API e prazo de cinco segundos na operação de pixels. O prazo segue a [semântica do Sharp](https://sharp.pixelplumbing.com/api-output/#timeout); leitura de metadados e espera na fila nativa não compõem um prazo absoluto de ponta a ponta. Cancelamento é verificado antes de processar e antes de persistir. A autorização também ocorre antes de decodificar. Esses controles não equivalem a um scanner antivírus ou a quotas globais de armazenamento.

## Persistência e uso posterior

A migração 007 grava metadados em `media_assets` e bytes em `media_contents`, com chave estrangeira composta `(workspace_id, asset_id)`. O armazenamento inicial é `bytea` privado no PostgreSQL, atrás do port `MediaStore`, sem exigir serviço de objetos externo. Criação e auditoria são atômicas; falha da auditoria desfaz metadados e conteúdo juntos. Listagens e eventos não carregam os bytes/base64; auditoria não registra nomes de arquivos.

SHA-256 e dimensões descrevem o conteúdo reprocessado. O download usa nome gerado por UUID, MIME fixo, `nosniff` e `Cache-Control: no-store`. O proxy preserva bytes e cabeçalhos seguros. A rota autenticada não é uma URL pública utilizável pelo fornecedor RCS.

O dispatcher publica acesso temporário por `/provider-media/:token`, com token aleatório de 32 bytes e somente seu hash persistido. O grant fixa workspace, conexão, tentativa e asset da versão enviada, exige tentativa reservada e expira em até sete dias. GET/HEAD verificam conexão/workspace ativos e tentativa sending/accepted/unknown. MIME fixo, nosniff e no-store preservam o contrato; token desconhecido ou vencido não libera bytes. Caddy encaminha apenas essa rota específica além dos callbacks. Não há busca de imagens em URLs arbitrárias.

O construtor usa imagens privadas; os adaptadores externos implementados aceitam PNG/JPEG de até 2 MiB conforme seus contratos. WebP privado não implica compatibilidade externa. PDF não é suportado. Grants vencidos podem ser removidos pela [compactação limitada](history-maintenance.md); assets usados por versões não são apagados.

Testes cobrem processamento, corrupção, metadados, cancelamento, permissões, isolamento, rollback, transporte binário e grants vinculados à tentativa com expiração. A prova de grant também passou com PostgreSQL nativo; consulte [validação](validation.md). Migrações 007 e 028 são necessárias.
