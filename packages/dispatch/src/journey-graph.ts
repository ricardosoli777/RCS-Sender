export const nodeTypes = ['start','message','wait','condition','branch','tag','score','webhook','goal','end'] as const;
export type NodeType = typeof nodeTypes[number];
export type JourneyNode = { id: string; type: NodeType; position: { x: number; y: number }; config: Record<string,unknown> };
export type JourneyEdge = { id: string; source: string; target: string; port: string };
export type JourneyGraph = { nodes: JourneyNode[]; edges: JourneyEdge[]; viewport: { x: number; y: number; zoom: number } };
export type GraphIssue = { code: string; nodeId?: string };
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const operators = ['equals','not_equals','exists','not_exists','greater_than','greater_or_equal','less_than','less_or_equal','contains','not_contains'];
const sources = ['contact','message_event','lead_score','tag','custom_field','journey_context'];
function record(value: unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string,unknown>,allowed: string[]) { return Object.keys(value).every((key) => allowed.includes(key)); }
export function validCondition(value: unknown): boolean {
  if (!record(value) || !keys(value,['source','field','operator','value','waitForEvent','timeoutMinutes']) || !sources.includes(String(value.source)) || !operators.includes(String(value.operator))) return false;
  if ((value.waitForEvent!==undefined || value.timeoutMinutes!==undefined) && (value.source!=='message_event' || value.waitForEvent!==true || !Number.isInteger(value.timeoutMinutes) || Number(value.timeoutMinutes)<1 || Number(value.timeoutMinutes)>525600)) return false;
  if (typeof value.field !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(value.field) || ['__proto__','prototype','constructor'].some((part) => value.field!.toString().split('.').includes(part))) return false;
  if (['exists','not_exists'].includes(String(value.operator))) return value.value === undefined;
  return (typeof value.value === 'string' && value.value.length<=1000) || typeof value.value === 'boolean' || (typeof value.value === 'number' && Number.isFinite(value.value)) || value.value === null;
}
export function validateGraph(input: unknown): GraphIssue[] {
  if (!record(input) || !keys(input,['nodes','edges','viewport']) || !Array.isArray(input.nodes) || !Array.isArray(input.edges) || input.nodes.length<2 || input.nodes.length>200 || input.edges.length>500 || !record(input.viewport) || !keys(input.viewport,['x','y','zoom']) || ![input.viewport.x,input.viewport.y,input.viewport.zoom].every((value) => typeof value === 'number' && Number.isFinite(value)) || Number(input.viewport.zoom)<0.1 || Number(input.viewport.zoom)>4) return [{ code: 'invalid_graph' }];
  const issues: GraphIssue[] = []; const nodes = new Map<string,JourneyNode>(); const edges: JourneyEdge[] = []; const edgeIds = new Set<string>();
  const issue = (code: string,nodeId?: string) => issues.push({ code,...(nodeId ? { nodeId } : {}) });
  for (const value of input.nodes) {
    if (!record(value) || !keys(value,['id','type','position','config']) || typeof value.id !== 'string' || !idPattern.test(value.id) || !nodeTypes.includes(value.type as NodeType) || !record(value.position) || !keys(value.position,['x','y']) || ![value.position.x,value.position.y].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate) && Math.abs(coordinate)<=1000000) || !record(value.config)) { issue('invalid_node'); continue; }
    if (nodes.has(value.id)) { issue('duplicate_node',value.id); continue; } const node = value as JourneyNode; nodes.set(node.id,node); const c = node.config;
    let valid = false;
    switch (node.type) {
      case 'start': case 'end': valid = keys(c,[]); break;
      case 'message': valid = keys(c,['messageVersionId','connectionId','agentId']) && typeof c.messageVersionId === 'string' && uuid.test(c.messageVersionId) && typeof c.connectionId === 'string' && uuid.test(c.connectionId) && typeof c.agentId === 'string' && c.agentId.trim().length>0 && c.agentId.length<=128; break;
      case 'wait': valid = c.mode === 'duration' ? keys(c,['mode','amount','unit']) && Number.isInteger(c.amount) && Number(c.amount)>0 && Number(c.amount)<=525600 && ['minutes','hours','days'].includes(String(c.unit)) && Number(c.amount)*({ minutes: 60000,hours: 3600000,days: 86400000 }[c.unit as 'minutes' | 'hours' | 'days'] ?? Infinity)<=31536000000 : keys(c,['mode','untilAt']) && c.mode === 'until_datetime' && typeof c.untilAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(c.untilAt) && Number.isFinite(Date.parse(c.untilAt)) && new Date(c.untilAt).toISOString() === c.untilAt; break;
      case 'condition': valid = validCondition(c); break;
      case 'branch': valid = keys(c,['paths']) && Array.isArray(c.paths) && c.paths.length>=1 && c.paths.length<=10 && c.paths.every((path) => record(path) && keys(path,['key','condition']) && typeof path.key === 'string' && idPattern.test(path.key) && path.key!=='default' && validCondition(path.condition) && record(path.condition) && path.condition.waitForEvent===undefined) && new Set(c.paths.map((path) => (path as Record<string,unknown>).key)).size === c.paths.length; break;
      case 'tag': valid = keys(c,['action','tag']) && ['add','remove'].includes(String(c.action)) && typeof c.tag === 'string' && /^[a-z0-9_:-]{1,64}$/.test(c.tag); break;
      case 'score': valid = keys(c,['action','value']) && ['increase','decrease','set'].includes(String(c.action)) && Number.isInteger(c.value) && Number(c.value)>=0 && Number(c.value)<=1000000; break;
      case 'webhook': valid = keys(c,['endpointId','endpointVersionId']) && (c.endpointVersionId===undefined || typeof c.endpointVersionId==='string' && uuid.test(c.endpointVersionId)) && typeof c.endpointId === 'string' && uuid.test(c.endpointId); break;
      case 'goal': valid = keys(c,['goal','stop']) && typeof c.goal === 'string' && /^[a-z0-9_:-]{1,64}$/.test(c.goal) && typeof c.stop === 'boolean'; break;
    }
    if (!valid) issue('invalid_configuration',node.id);
  }
  for (const value of input.edges) {
    if (!record(value) || !keys(value,['id','source','target','port']) || typeof value.id !== 'string' || !idPattern.test(value.id) || typeof value.source !== 'string' || typeof value.target !== 'string' || typeof value.port !== 'string' || !idPattern.test(value.port)) { issue('invalid_edge'); continue; }
    if (edgeIds.has(value.id)) issue('duplicate_edge'); edgeIds.add(value.id); const edge = value as JourneyEdge;
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) issue('missing_node'); edges.push(edge);
  }
  const starts = [...nodes.values()].filter((node) => node.type==='start'); if (starts.length!==1) issue('one_start_required');
  for (const node of nodes.values()) {
    const outgoing = edges.filter((edge) => edge.source===node.id); const ports = outgoing.map((edge) => edge.port);
    const required = node.type==='end' || (node.type==='goal' && node.config.stop===true) ? [] : node.type==='condition' ? ['true','false'] : node.type==='branch' && Array.isArray(node.config.paths) ? [...node.config.paths.map((path) => String((path as Record<string,unknown>).key)),'default'] : ['next'];
    if (ports.length!==required.length || required.some((port) => ports.filter((value) => value===port).length!==1)) issue('invalid_paths',node.id);
    if (node.type==='start' && edges.some((edge) => edge.target===node.id)) issue('start_has_incoming',node.id);
  }
  const reachable = new Set<string>(); const visiting = new Set<string>(); const visited = new Set<string>(); let cycle = false;
  function walk(id: string) { if (visiting.has(id)) { cycle = true; return; } if (visited.has(id)) return; visiting.add(id); reachable.add(id); for (const edge of edges.filter((edge) => edge.source===id)) walk(edge.target); visiting.delete(id); visited.add(id); }
  if (starts[0]) walk(starts[0].id); for (const id of nodes.keys()) { if (!reachable.has(id)) issue('unreachable_node',id); }
  // Check cycles even inside unreachable components.
  for (const id of nodes.keys()) if (!visited.has(id)) walk(id); if (cycle) issue('cycles_forbidden');
  if (![...nodes.values()].some((node) => node.type==='end' || (node.type==='goal' && node.config.stop===true))) issue('end_required');
  return issues;
}
