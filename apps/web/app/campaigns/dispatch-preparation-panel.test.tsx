import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import DispatchPreparationPanel from './dispatch-preparation-panel';
import { campaignStatusLabel,type Campaign,type DispatchPreparationSnapshot } from './model';
vi.mock('next/navigation',() => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const campaign: Campaign = { id: 'campaign',name: 'Example',objective: 'Example',status: 'ready',execution_mode: 'dispatch',revision: 2,provider_connection_id: 'connection',agent_id: 'agent',audience_list_id: 'list',message_version_id: 'version',scheduled_at: null };
const snapshot: DispatchPreparationSnapshot = { runId: 'run',campaignId: campaign.id,revision: 2,status: 'ready',confirmed: false,counts: { total: 3,eligible: 1,suppressed: 1,unavailable: 1 },executionAvailable: false };
const render = (overrides: Partial<React.ComponentProps<typeof DispatchPreparationPanel>> = {}) => renderToStaticMarkup(<DispatchPreparationPanel campaign={campaign} workspaceId="workspace" canSend initialSnapshot={snapshot} unavailable={false} cachedEligible={1} {...overrides} />);
describe('dispatch preparation presentation',() => {
  it('shows frozen counts, limited confirmation and separate actions without claiming delivery or consent',() => {
    const html = render();
    for (const label of ['Contatos congelados','Elegíveis na preparação','Suprimidos por opt-out','Sem elegibilidade válida na preparação','Confirmar configuração congelada','Cancelar preparação','não comprova consentimento','Preparar ou confirmar não envia mensagens']) expect(html).toContain(label);
    expect(html).not.toContain('Enviar mensagens'); expect(html).not.toContain('phone_normalized');
    expect(campaignStatusLabel(campaign)).toBe('Preparação de despacho');
  });
  it('preserves confirmation history after cancellation and hides all write actions for readers',() => {
    const html = render({ initialSnapshot: { ...snapshot,confirmed: true,status: 'cancelled' } });
    expect(html).toContain('Preparação cancelada'); expect(html).toContain('confirmação permanece no histórico'); expect(html).not.toContain('<button');
    expect(render({ canSend: false })).not.toContain('<button');
    expect(render({ initialSnapshot: { ...snapshot,confirmed: true } })).not.toContain('Confirmar configuração congelada');
  });
  it('blocks incomplete drafts and stale or unavailable preparation state',() => {
    const draft = { ...campaign,status: 'draft' as const,execution_mode: null };
    const incomplete = render({ campaign: draft,initialSnapshot: null,cachedEligible: 0 });
    expect(incomplete).toContain('disabled=""'); expect(incomplete).toContain('Complete a configuração');
    expect(render({ initialSnapshot: { ...snapshot,revision: 1 } })).toContain('disabled=""');
    const unavailable = render({ campaign: draft,initialSnapshot: null,unavailable: true });
    expect(unavailable).toContain('role="alert"'); expect(unavailable).not.toContain('<button');
    const valid = render({ campaign: draft,initialSnapshot: null }); expect(valid).toContain('Preparar configuração de despacho'); expect(valid).not.toContain('disabled=""');
  });
});
