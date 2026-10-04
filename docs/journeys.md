# Jornadas e funis

A página Jornadas permite criar sequências com várias mensagens e avançar cada lead conforme suas respostas, entregas, leituras, tags e pontuação. O canvas oferece paleta, conexões, edição, desfazer/refazer, minimapa, zoom, autosave, validação e publicação. Versões publicadas são imutáveis; cada participação mantém sua versão original.

Nós disponíveis: início, mensagem, espera, condição, ramificação, tag, pontuação, webhook, meta e fim. Grafos com ciclos, nós desconectados, portas inválidas e referências indisponíveis não podem ser publicados. As condições usam seletores restritos; não executam JavaScript. Condições sobre eventos exigem suporte declarado pelo adaptador.

Uma mensagem fixa a versão do modelo, conexão e agente. O motor cria um despacho individual e usa o mesmo ledger de campanhas. Elegibilidade, consentimento da finalidade, telefone atual, opt-out, acesso do operador e vínculo da conexão são conferidos antes do envio. Formatos avançados usam a matriz do fornecedor, capacidades do agente/destinatário e grants temporários de mídia; suporte desconhecido bloqueia o envio.

Entradas: manual, lista, público de campanha, evento autenticado da API e adição de tag. Lotes congelam versão e telefone e aceitam até 5.000 contatos. Um `requestId` reutilizado não cria outro lote. A política pode impedir participações simultâneas ou qualquer repetição do contato. Uma fonte de campanha prefere os destinatários congelados; a lista atual serve de origem somente antes de existir snapshot.

Esperas persistem no PostgreSQL. A duração ou data programada gera uma tarefa com revisão; revisões antigas não avançam o lead. Condições podem aguardar eventos até um prazo explícito. Uma leitura correlacionada com a mensagem, conexão e telefone corretos pode antecipar a retomada. A ausência do evento segue a saída falsa no timeout.

Pausar impede novas ações enquanto a jornada estiver pausada. Arquivar encerra participações quando o motor as examina. Uma chamada já iniciada pode terminar. Opt-out interrompe participações e despachos ainda não reservados. Envio ou POST com resultado incerto nunca é repetido automaticamente.

Webhooks de saída usam endpoints HTTPS versionados e criptografados. O payload contém IDs do workspace, jornada, versão, participação, contato e nó. O transporte resolve apenas IPv4 público, fixa o endereço no socket, valida TLS e bloqueia redirects. O ledger é gravado antes do POST.

Pontuação possui regras, classificação, histórico e evento de qualificação. Analytics mostram participações, transições, caminhos, interrupções, metas e tempo médio até a meta. Aceite, entrega e leitura são medidas distintas. O Inbox recebe eventos canônicos, permite assumir/remover responsável e prepara uma resposta como campanha para revisão e confirmação.

Respostas sugeridas são correlacionadas à tentativa aceita mais recente, conexão e telefone. O seletor de caminho grava `journey_branch:journeyId:nodeId:pathKey`; o motor só aceita caminhos existentes no nó atual da versão fixada. Uma condição pode aguardar `actionPayload` com timeout antes da ramificação. Respostas de outra jornada ou tentativa não mudam o percurso. Leitura e resposta recebidas antes do avanço do nó são recuperadas dos eventos cifrados persistidos.

As provas locais incluem PGlite, PostgreSQL nativo, processos independentes e Chromium, conforme [validação](validation.md). Transportes de fornecedor são simulados; não houve entrega RCS real.
