import { describe,expect,it } from 'vitest';
import { validateGraph,validCondition,type JourneyGraph } from './journey-graph.js';
const graph = (): JourneyGraph => ({ nodes: [{ id: 'start',type: 'start',position: { x: 0,y: 0 },config: {} },{ id: 'end',type: 'end',position: { x: 300,y: 0 },config: {} }],edges: [{ id: 'edge',source: 'start',target: 'end',port: 'next' }],viewport: { x: 0,y: 0,zoom: 1 } });
describe('journey graph publication contract',() => {
  it('accepts complete paths and validates bounded drafts without execution',() => { expect(validateGraph(graph())).toEqual([]); expect(validateGraph(null)).toEqual([{ code: 'invalid_graph' }]); expect(validateGraph({ ...graph(),viewport: { x: 0,y: 0,zoom: Infinity } })).toEqual([{ code: 'invalid_graph' }]); });
  it('rejects duplicate starts, orphans, missing targets and cycles',() => {
    const duplicate = graph(); duplicate.nodes.push({ ...duplicate.nodes[0]!,id: 'extra' }); expect(validateGraph(duplicate)).toEqual(expect.arrayContaining([{ code: 'one_start_required' },{ code: 'unreachable_node',nodeId: 'extra' }]));
    const cycle = graph(); cycle.edges.push({ id: 'loop',source: 'end',target: 'start',port: 'next' }); expect(validateGraph(cycle)).toEqual(expect.arrayContaining([{ code: 'cycles_forbidden' },{ code: 'start_has_incoming',nodeId: 'start' }]));
    const missing = graph(); missing.edges[0]!.target='missing'; expect(validateGraph(missing)).toEqual(expect.arrayContaining([{ code: 'missing_node' }]));
  });
  it('requires distinct true/false paths and protects condition selectors',() => {
    const g = graph(); g.nodes.splice(1,0,{ id: 'check',type: 'condition',position: { x: 100,y: 0 },config: { source: 'lead_score',field: 'score',operator: 'greater_or_equal',value: 25 } });
    g.edges = [{ id: 'entry',source: 'start',target: 'check',port: 'next' },{ id: 'yes',source: 'check',target: 'end',port: 'true' },{ id: 'no',source: 'check',target: 'end',port: 'false' }]; expect(validateGraph(g)).toEqual([]);
    g.edges[2]!.port='true'; expect(validateGraph(g)).toEqual(expect.arrayContaining([{ code: 'invalid_paths',nodeId: 'check' }]));
    expect(validCondition({ source: 'contact',field: '__proto__.value',operator: 'equals',value: true })).toBe(false);
    expect(validCondition({ source: 'custom_field',field: 'interest',operator: 'exists' })).toBe(true);
  });
  it('rejects invalid waits and message references while allowing bounded time and score actions',() => {
    const g = graph(); g.nodes.splice(1,0,{ id: 'wait',type: 'wait',position: { x: 100,y: 0 },config: { mode: 'duration',amount: 1,unit: 'days' } }); g.edges[0]!.target='wait'; g.edges.push({ id: 'after',source: 'wait',target: 'end',port: 'next' }); expect(validateGraph(g)).toEqual([]);
    g.nodes[1]!.config.amount=366; expect(validateGraph(g)).toEqual(expect.arrayContaining([{ code: 'invalid_configuration',nodeId: 'wait' }]));
    g.nodes[1]!.type='message'; g.nodes[1]!.config={ messageVersionId: 'foreign',connectionId: 'foreign',agentId: '' }; expect(validateGraph(g)).toEqual(expect.arrayContaining([{ code: 'invalid_configuration',nodeId: 'wait' }]));
  });
  it('rejects forged top-level fields and repeated node IDs or output ports',() => { expect(validateGraph({ ...graph(),execute: true })).toEqual([{ code: 'invalid_graph' }]); const g = graph(); g.nodes.push(g.nodes[1]!); expect(validateGraph(g)).toEqual(expect.arrayContaining([{ code: 'duplicate_node',nodeId: 'end' }])); });
});
