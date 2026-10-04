import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it,expect,vi } from 'vitest';
import JourneyBuilder from './builder';
import type { JourneySnapshot } from './model';
vi.mock('next/navigation',() => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const snapshot: JourneySnapshot = { journey: { id: 'journey',name: 'Funnel',revision: 1,status: 'draft',published_version: null },version: null,versions: [],graph: { nodes: [{ id: 'start',type: 'start',position: { x: 0,y: 0 },config: {} },{ id: 'end',type: 'end',position: { x: 200,y: 0 },config: {} }],edges: [{ id: 'a',source: 'start',target: 'end',port: 'next' }],viewport: { x: 0,y: 0,zoom: 1 } } };
describe('journey access presentation',() => {
  it('keeps published versions and reader views without publish controls or interactive ports',() => { for (const initial of [snapshot,{ ...snapshot,version: 1 }]) { const html = renderToStaticMarkup(<JourneyBuilder workspace="w" initial={initial} canManage={false} canPublish={false} connections={[]} messages={[]} />); expect(html).not.toContain('Publicar versão'); expect(html).not.toContain('Conectar saída'); expect(html).toContain('Miniatura do fluxo'); } });
  it('offers validation and publishing for managers on drafts',() => { const html = renderToStaticMarkup(<JourneyBuilder workspace="w" initial={snapshot} canManage canPublish connections={[]} messages={[]} />); expect(html).toContain('Validar fluxo'); expect(html).toContain('Publicar versão'); expect(html).toContain('Desfazer'); expect(html).toContain('Conectar saída'); });
});
