import React from 'react';
import Link from 'next/link';
import { Card } from '../ui';
import { reviewIssue,type CampaignReview } from './model';
export default function LocalReview({ review,workspaceId }: { review: CampaignReview; workspaceId: string }) {
  return <Card><h2>Revisão local · configuração salva</h2><p>Revisão {review.campaign.revision}. Os totais usam a composição atual da lista.</p><dl className="campaignTotals"><div><dt>Contatos na lista</dt><dd>{review.audience.total}</dd></div><div><dt>Com opt-out</dt><dd>{review.audience.optedOut}</dd></div><div><dt>Sem opt-out registrado</dt><dd>{review.audience.remaining}</dd></div></dl><p>Sem opt-out registrado não comprova consentimento nem suporte a RCS.</p>
    <h3>Elegibilidade salva · revisão local</h3><p>Dados agregados de consultas anteriores, sem consultar APIs. Elegibilidade não comprova consentimento, entrega ou prontidão de envio.</p>
    <dl className="campaignTotals"><div><dt>Elegíveis no cache</dt><dd>{review.eligibility.counts.eligible}</dd></div><div><dt>Não elegíveis no cache</dt><dd>{review.eligibility.counts.ineligible}</dd></div><div><dt>Bloqueados</dt><dd>{review.eligibility.counts.blocked}</dd></div><div><dt>Resultado desconhecido</dt><dd>{review.eligibility.counts.unknown}</dd></div><div><dt>Consulta inválida ou expirada</dt><dd>{review.eligibility.counts.stale}</dd></div><div><dt>Sem consulta nesta conexão</dt><dd>{review.eligibility.counts.unchecked}</dd></div></dl>
    {review.message && <p><Link href={`/messages/${review.message.message_id}?workspace=${encodeURIComponent(workspaceId)}&version=${review.message.version}`}>Consultar mensagem vinculada · versão {review.message.version}</Link></p>}
    <h3>Pendências</h3><ul>{review.issues.map((issue) => <li key={issue}>{reviewIssue(issue)}</li>)}</ul><p>Esta revisão não chama fornecedores nem inicia um envio. Atualize a página para consultar novamente.</p>
  </Card>;
}
