# Registro de consentimento RCS — Wave 15

A migração 015 e `ContactConsents` adicionam um registro local por workspace, telefone e finalidade de mensagem: marketing, transactional ou authentication. Cada declaração ou revogação cria uma revisão imutável. Importar um contato, consultar elegibilidade, preparar ou confirmar uma campanha não cria consentimento. Registros existentes permanecem desconhecidos; não há backfill automático.

O estado registrado é uma informação fornecida por um operador autorizado, com referência da evidência. O sistema valida o contrato e preserva a declaração; não consulta a fonte externa nem verifica autenticidade ou adequação da evidência. Esta etapa não implementa captura automática de opt-in ou uma política jurídica por região/fornecedor.

## API

Base: `/workspaces/:workspaceId/contacts/:contactId/rcs-consents`, também permitida no proxy web.

`GET` exige `contacts.view` e retorna ID do contato, telefone atual, opt-out e três resumos de finalidade. Sem registro, cada resumo tem state unknown, revision 0 e source/observedAt null. Quando há histórico, retorna a revisão mais recente para o telefone e a finalidade. Referência da evidência e identidade do solicitante não são expostas nesse resumo. O histórico completo permanece no banco, sem endpoint de edição, exclusão ou exportação nesta etapa.

`POST` exige `contacts.manage`, sessão e CSRF válidos. O corpo estrito, limitado a 2 KiB na API, contém:

| Campo | Contrato |
| --- | --- |
| `purpose` | marketing, transactional ou authentication. |
| `state` | granted ou revoked. |
| `source` | manual_record, web_form, import_record ou customer_request; origem declarada pelo operador. |
| `evidenceReference` | Referência de 1–128 caracteres alfanuméricos, ponto, sublinhado, dois-pontos, barra ou hífen; começa com letra/número. Use um identificador de evidência, não conteúdo bruto ou segredo. |
| `observedAt` | Data canônica UTC com milissegundos, sem data futura; identifica quando a declaração/revogação foi observada. |
| `expectedRevision` | Revisão atual da finalidade para esse telefone, ou 0 quando desconhecida. |
| `expectedPhone` | Telefone mostrado na leitura que originou o registro. Mudança antes da gravação causa conflito. |

A gravação responde 201 com o resumo atualizado. Telefone ou revisão divergentes e observação anterior à última registrada retornam 409. Referências/formato inválidos retornam 400. Contato de outro workspace fica indisponível; leitores consultam sem poder registrar. O proxy limita o corpo a 8 KiB e permite somente GET/POST. Respostas usam no-store.

## Integridade e despacho

A transação revalida conta/workspace/papel e telefone, insere a próxima revisão e audita atomicamente. Falha de auditoria desfaz a revisão. A tabela recusa alterações/exclusões, telefones divergentes, revisões fora da sequência e observações anteriores. A ordenação usa revisão, não a ordem de chegada de timestamps. A auditoria registra apenas finalidade, estado e revisão; não inclui telefone ou referência da evidência.

Trocar o telefone de um contato não transfere registros para o novo número. O histórico continua vinculado ao telefone originalmente declarado. Registrar granted para um telefone com opt-out não remove o opt-out; esse telefone permanece bloqueado para despacho e importação conforme o domínio existente. Não há reativação automática.

O núcleo interno `CampaignDispatch` exige que a última revisão para o telefone congelado e a finalidade da versão de mensagem seja granted. Ausência, revoked ou declaração para outra finalidade bloqueiam antes da reserva ou chamada de fornecedor. Depois da reserva e consulta do agente, o checkpoint SQL anterior a send verifica novamente o consentimento atual. Uma revogação nessa etapa impede send e preserva a rejeição no ledger. SQL e fornecedor não compartilham transação; revogação posterior à invocação não pode desfazer a operação externa, e o protocolo completo de controles continua pendente.

Preparação e confirmação continuam sendo operações de configuração: suas contagens descrevem elegibilidade salva, sem afirmar consentimento. Não há envio real exposto em HTTP ou worker. O registro por finalidade é uma condição local do núcleo, sem presumir estratégias específicas de um fornecedor.

## Interface de contatos

A lista de contatos oferece **Consentimento RCS** para cada contato, inclusive a leitores. O link mantém o workspace e abre `/contacts/:contactId?workspace=…`. A página carrega o telefone atual e os resumos pela API protegida; falha de leitura ou contato indisponível não cria formulário. Ao trocar o workspace no detalhe, a navegação volta à lista de contatos do workspace escolhido.

A tabela apresenta finalidade, estado registrado, revisão, origem declarada e data observada em UTC. Opt-out continua visível mesmo quando uma finalidade tem declaração granted. Leitores consultam a tabela sem controles de alteração. Gestores escolhem finalidade, declaração/revogação, origem, referência da evidência e data/horário da observação explicitamente em UTC. A evidência e a data não são preenchidas automaticamente.

Antes da gravação, o formulário valida referência, data real já ocorrida, cronologia e finalidade carregada, e solicita confirmação com telefone/finalidade/data. Usa telefone e revisão da leitura, mantendo validação final na API. Depois de sucesso, atualiza os resumos e limpa evidência/data. Conflito, revogação de acesso ou resposta inconclusiva bloqueiam novas gravações até recarregar os registros; não existe retry automático. O prazo da chamada é de dez segundos. Alterar telefone ou revisão exige conferir uma leitura atual antes de registrar novamente.

O formulário permite preservar uma declaração para telefone com opt-out, conforme a API, sem remover o bloqueio. Declaração informada pelo operador não é exibida como evidência externamente verificada. A interface não consulta fornecedores, não cria jobs e não oferece reativação de opt-out.

## Validação atual

A bateria final passou com 442 testes, nove verificações de domínio em PostgreSQL nativo e sete cenários Chromium. Inclui isolamento, revisões, consentimento, snapshot, reserva multiprocesso, resultado incerto sem reenvio, callbacks e controles. Consulte [validação](validation.md) para evidências e limites.

Contas, agentes lançados, envio RCS real e deployment de VPS ficam para configuração posterior. Declarações locais não atestam a evidência de consentimento nem entrega real.
