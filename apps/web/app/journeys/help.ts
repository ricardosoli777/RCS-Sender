import type { NodeType } from './model';

export const nodeHelp: Record<NodeType,{ summary: string; instruction: string; example: string }> = {
  start: { summary: 'Entrada do lead',instruction: 'É o ponto de partida de todos os inscritos. Em Próxima etapa, escolha o primeiro passo que o lead deve executar.',example: 'Conecte Início à mensagem de boas-vindas.' },
  message: { summary: 'Envia uma mensagem',instruction: 'Escolha a conexão do fornecedor e uma versão ativa da mensagem. Crie o título, texto, imagem e botões em Mensagens. Depois selecione a Próxima etapa.',example: 'Envie as boas-vindas e conecte a uma Espera antes da próxima oferta.' },
  wait: { summary: 'Dá um intervalo',instruction: 'Use Duração para esperar a partir da chegada do lead nesta etapa. Escolha o número e a unidade. Data em UTC libera o lead em um horário fixo.',example: 'Duração 1 + Dias: cada lead espera um dia antes de seguir.' },
  condition: { summary: 'Decide entre Sim e Não',instruction: 'Escolha o dado a verificar, a comparação e o valor. Conecte a saída Sim para quem atende à regra e Não para quem não atende.',example: 'Pontuação → campo score → Maior ou igual → Número 50. Sim vai para uma oferta; Não vai para outra mensagem.' },
  branch: { summary: 'Escolhe entre vários caminhos',instruction: 'Crie uma regra para cada caminho. O primeiro caminho que atender à regra será usado. Conecte também Padrão, usado quando nenhuma regra atender.',example: 'Pontuação a partir de 80 vai para uma oferta premium; a partir de 50 vai para a oferta inicial; os demais seguem por Padrão.' },
  tag: { summary: 'Organiza o contato',instruction: 'Adicione ou remova uma etiqueta do contato. Use letras minúsculas, números, _ , : ou - e selecione a Próxima etapa.',example: 'Adicionar a tag recebeu_oferta permite identificar os contatos que passaram por esta etapa.' },
  score: { summary: 'Atualiza a pontuação',instruction: 'Some, subtraia ou defina os pontos do lead. Uma Condição posterior pode usar essa pontuação para escolher a próxima mensagem.',example: 'Somar 10 pontos depois que o lead seguir por um caminho de interesse.' },
  webhook: { summary: 'Avisa outro sistema',instruction: 'Selecione um endpoint ativo cadastrado em Webhooks. Esta etapa envia uma notificação para esse destino. Conecte a Próxima etapa.',example: 'Avise seu CRM quando o lead chegar à etapa de qualificação.' },
  goal: { summary: 'Registra uma conversão',instruction: 'Dê um nome à meta. Ela é registrada quando o lead chega a esta etapa. Marque Encerrar ao atingir a meta para finalizar; caso contrário, conecte a Próxima etapa.',example: 'Depois de um caminho que confirma interesse, registre a meta interessado. A meta não detecta uma compra sozinha.' },
  end: { summary: 'Finaliza a participação',instruction: 'Conecte a última etapa a este Fim. Ao chegar aqui, o lead encerra sua participação. Esta etapa não possui saída.',example: 'Depois da última mensagem, conecte a Fim.' },
};

export const conditionHelp: Record<string,string> = {
  contact: 'Use name para o nome ou opted_out para a opção de não receber mensagens. Exemplo: name → Existe.',
  lead_score: 'No campo, use score. Compare com um valor do tipo Número. Exemplo: Maior ou igual a 50.',
  tag: 'No campo, use tags; em Comparação, Contém; no valor do tipo Texto, informe a tag, como interessado.',
  message_event: 'Escolha o evento da última mensagem: leitura, resposta, clique em link ou entrega. Use Existe e marque Aguardar o evento para esperar pelo retorno do lead.',
  custom_field: 'Informe no campo a chave de um campo personalizado já cadastrado no contato e compare com o valor esperado.',
  journey_context: 'Informe uma chave que já exista no contexto desta participação. Use esta opção somente quando sua integração já fornecer esse dado.',
};
