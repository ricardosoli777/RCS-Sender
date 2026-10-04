import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import LocalReview from './review';
import type { CampaignReview } from './model';
const review: CampaignReview = { campaign: { id: 'campaign',name: 'Draft',objective: 'Review',status: 'draft',revision: 1,provider_connection_id: null,agent_id: null,audience_list_id: 'list',message_version_id: null,scheduled_at: null },audience: { total: 6,optedOut: 1,remaining: 5 },eligibility: { source: 'saved_checks',checkedAt: '2026-10-04T00:00:00.000Z',counts: { total: 6,blocked: 1,eligible: 1,ineligible: 1,unknown: 1,stale: 1,unchecked: 1 } },message: null,issues: ['eligibility_stale','eligibility_unchecked','private_media_not_published'],executionAvailable: false };
describe('saved campaign preflight review',() => {
  it('distinguishes cached categories and consent without declaring send readiness',() => {
    const html = renderToStaticMarkup(<LocalReview review={review} workspaceId="workspace" />);
    for (const label of ['Elegíveis no cache','Não elegíveis no cache','Resultado desconhecido','Consulta inválida ou expirada','Sem consulta nesta conexão','não comprova consentimento']) expect(html).toContain(label);
    expect(html).not.toContain('phone_normalized'); expect(html).not.toContain('<button');
  });
  it('translates preflight issues and renders unknown codes as a generic pending check',() => {
    const html = renderToStaticMarkup(<LocalReview review={{ ...review,issues: [...review.issues,'private-internal-code'] }} workspaceId="workspace" />);
    expect(html).toContain('Há consultas expiradas'); expect(html).toContain('mídia privada'); expect(html).not.toContain('eligibility_stale'); expect(html).not.toContain('private-internal-code');
  });
});
