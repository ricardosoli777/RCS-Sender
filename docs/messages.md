# Mensagens e versões

A biblioteca `/messages?workspace=…` lista mensagens com paginação, busca e filtros de estado/finalidade. O detalhe consulta versões atual, ativa e históricas, permite editar, ativar, arquivar, restaurar e duplicar. Leitores consultam; escrita exige `messages.manage`.

O construtor oferece texto, rich card, carrossel de 2–10 cartões, mídia e arquivo de imagem. Imagens privadas PNG/JPEG/WebP têm até 2 MiB e são reprocessadas no servidor; compatibilidade externa é independente. Os adaptadores implementados aceitam PNG/JPEG. O formato file prepara o domínio para imagens, sem afirmar suporte externo genérico ou PDF.

Categorias pertencem à versão e devem combinar com a finalidade: marketing (lançamento, oferta, promoção, convite, reengajamento, recuperação), transacional (confirmação, lembrete, atualização, agendamento) ou autenticação (OTP, verificação, recuperação de senha). Alterar finalidade limpa uma categoria incompatível; versões antigas permanecem intactas.

Respostas sugeridas têm payload; ações usam URL HTTPS. O seletor de caminho da jornada grava jornada, nó e caminho no payload de resposta. O runtime só segue esse destino no nó atual da versão fixada e após correlação à tentativa aceita, conexão e telefone. Veja [jornadas](journeys.md).

Salvar cria versão nova sem alterar a ativa. Ativação exige ação explícita. Conflitos de revisão retornam 409 e preservam a edição; arquivadas precisam voltar a rascunho antes de editar. Duplicação copia a versão atual e categoria, sem copiar estado ativo. Não há exclusão física pela API.

Prévia, contadores e comparação de capacidades ajudam a construir o conteúdo. `GET /workspaces/:workspaceId/messages/provider-options` retorna capacidades/limites públicos, sem credenciais. O rascunho pode ser salvo mesmo quando um provedor não suporta o formato; o dispatcher bloqueia incompatibilidade, suporte desconhecido, agente/destinatário indisponível e ausência de consentimento/elegibilidade antes de enviar. Mídia usa [grants temporários](media.md).

| Rota relativa ao workspace | Operação |
| --- | --- |
| `POST /messages` | Cria rascunho com nome, finalidade, categoria opcional e conteúdo |
| `GET /messages` | Lista com paginação/filtros |
| `GET /messages/:id` | Metadados e versões atual/ativa |
| `PUT /messages/:id` | Nova versão com conteúdo completo e expectedVersion |
| `PATCH /messages/:id/status` | Muda estado com expectedVersion |
| `GET /messages/:id/versions/:version` | Snapshot histórico |

Os limites do app incluem nome 100, texto/corpo 10.000, título 200, até dez sugestões somadas, rótulo 100, payload 256, URL 2.048 e corpo HTTP 64 KiB. Cada fornecedor pode impor limites menores. Versões, referências de assets e auditoria são atômicas e isoladas por workspace; conteúdo histórico é imutável.

Migrações 008, 028 e 033 implementam formatos e categorias versionadas. Testes de domínio e Chromium verificam edição, categoria/carrossel/seleção de caminho e preservação da versão ativa, conforme [validação](validation.md). Nenhum teste local constitui entrega RCS real.
