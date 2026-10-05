# Criar conteúdo, campanhas e jornadas

## Integrações

Escolha um dos cinco fornecedores em **Integrações**. Informe nome, ambiente e credenciais da conta e clique em **Salvar conexão**. Os campos são limpos após uma gravação bem-sucedida e os segredos não são devolvidos pela API. Use **Testar conexão** para consultar o fornecedor quando desejar. O estado real aparece na conexão; salvar não envia uma mensagem nem confirma acesso externo.

Os adaptadores atuais oferecem ambiente `test`. Esse rótulo não é um simulador nem comprova conta/agente liberados. Confirmação remota ainda tem os [limites documentados](providers/README.md); o envio conserva as validações necessárias.

## Mensagem com título, texto, imagem e botão

1. Abra **Mensagens** e o formulário **Nova mensagem**.
2. Preencha nome, finalidade e categoria. Escolha **Rich card** no formato.
3. Preencha **Título** e **Texto**. Em **Enviar imagem**, selecione PNG/JPEG/WebP estático até 2 MiB, ou reutilize uma imagem do workspace. Compatibilidade externa depende do fornecedor; PNG/JPEG são os formatos implementados para envio.
4. Em **Ações e respostas sugeridas**, clique em **Adicionar sugestão**.
5. Escolha **Abrir URL HTTPS**, preencha o rótulo (por exemplo, “Ver oferta”) e **URL da ação** com `https://seusite.com/oferta`.
6. Clique no botão da prévia: um link válido abre em uma nova aba. Respostas sugeridas simulam a escolha dentro da prévia, sem publicar um evento ou avançar um lead.
7. Clique em **Criar rascunho**. No detalhe, use **Ativar versão** para disponibilizá-la nos seletores de campanhas e jornadas.

**Carrossel** permite vários cards: escolha uma imagem e aplique no cartão desejado. Imagens pertencem às mensagens; não é necessário inserir a imagem novamente na campanha ou na jornada.

## Campanha

Campanha usa uma mensagem para uma audiência. Cadastre contatos/listas em **Contatos**, configure uma conexão em **Integrações** e ative a mensagem. Em **Campanhas → Nova campanha**, escolha nome, objetivo, conexão, agente vinculado, lista e versão da mensagem. Clique em **Criar campanha** e abra o detalhe.

Confira as pendências e separe simulação de despacho real. Preparar a audiência e confirmar são passos distintos do comando de envio. Opt-out, consentimento, elegibilidade e acesso ao fornecedor continuam necessários. Salvar uma data no rascunho não inicia uma fila automaticamente.

## Jornada

As listas de **Mensagens**, **Campanhas** e **Jornadas** mostram uma coluna **Ações**, com lápis **Editar** e lixeira **Excluir**. Editar abre diretamente o formulário. Mensagens e cards são salvos em **Salvar nova versão**; campanhas usam **Salvar rascunho**. Jornadas salvam automaticamente e também têm **Salvar rascunho** no topo do editor.

Excluir pede confirmação e retira o item da lista. Versões e histórico de execução permanecem preservados. Uma mensagem vinculada a campanha ou jornada precisa ser desvinculada ou ter o fluxo encerrado antes. Campanhas em execução devem ser encerradas/canceladas; jornadas ativas ou pausadas devem ser arquivadas. Os cards de um carrossel são editados nos seus campos e removidos pelo botão com lixeira **Remover cartão**; as alterações são persistidas ao salvar a mensagem.

Jornada é um fluxo com várias etapas e mensagens. Em **Jornadas**, informe o nome e clique em **Criar jornada**. Adicione etapas pela paleta e clique em cada etapa para configurar no painel lateral.

Na etapa **Mensagem**, escolha conexão, agente e versão ativa da mensagem. Na etapa **Espera**, defina tempo ou evento. Conecte as saídas no canvas ou pelo seletor **Próxima etapa**. Exemplo: **Início → Mensagem de boas-vindas → Espera de 1 dia → Mensagem de oferta → Fim**.

Confira o autosave, use **Validar fluxo**, **Publicar versão** e **Ativar jornada**. Depois inscreva contatos manualmente ou pelas entradas de lista/campanha/tag disponíveis. Cada participação usa a versão publicada com que começou.
