import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import DispatchPanel,{ type DispatchSummary } from './dispatch-panel';
vi.mock('next/navigation',() => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const initial: DispatchSummary = { campaignId: 'campaign',revision: 3,runId: 'run',executionAvailable: true,counts: { pending: 0,processing: 0,completed: 0,unresolved: 0,discarded: 0,dead: 0 } };
const render = (overrides: Partial<React.ComponentProps<typeof DispatchPanel>> = {}) => renderToStaticMarkup(<DispatchPanel workspaceId="workspace" campaignId="campaign" revision={3} canSend initial={initial} {...overrides} />);
describe('dispatch queue presentation',() => {
  it('offers pause/stop and explicit resume only to writers with an existing queue',()=>{
    const counts={...initial.counts,pending:2};expect(render({initial:{...initial,status:'ready',counts}})).toContain('Pausar despacho');const paused=render({initial:{...initial,status:'paused',counts}});expect(paused).toContain('Retomar despacho');expect(paused).toContain('Parar despacho');expect(render({canSend:false,initial:{...initial,status:'paused',counts}})).not.toContain('Retomar despacho');
  });
  it('enables enqueue only with matching available empty confirmed run',() => {
    expect(render()).toContain('Enfileirar preparação confirmada'); expect(render()).not.toContain('disabled=""');
    expect(render({ initial: { ...initial,executionAvailable: false } })).toContain('disabled=""');
    expect(render({ initial: { ...initial,runId: null } })).toContain('disabled=""');
    expect(render({ initial: { ...initial,revision: 2 } })).toContain('role="alert"');
    expect(render({ initial: null })).not.toContain('<button');
  });
  it('shows aggregate results without claiming delivery or offering repeated enqueue',() => {
    const html = render({ initial: { ...initial,counts: { ...initial.counts,completed: 1,unresolved: 2 } } });
    expect(html).toContain('Resultado inconclusivo'); expect(html).toContain('não comprova entrega'); expect(html).toContain('não são reenviados automaticamente'); expect(html).not.toContain('<button');
  });
  it('lets readers view queue counts without mutation actions',() => { expect(render({ canSend: false })).toContain('Fila de despacho'); expect(render({ canSend: false })).not.toContain('<button'); });
});
