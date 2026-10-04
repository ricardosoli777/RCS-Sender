export type NodeType = 'start' | 'message' | 'wait' | 'condition' | 'branch' | 'tag' | 'score' | 'webhook' | 'goal' | 'end';
export type JourneyNode = { id: string; type: NodeType; position: { x: number; y: number }; config: Record<string,unknown> };
export type JourneyGraph = { nodes: JourneyNode[]; edges: { id: string; source: string; target: string; port: string }[]; viewport: { x: number; y: number; zoom: number } };
export type Journey = { id: string; name: string; status: string; revision: number; published_version: number | null };
export type JourneySnapshot = { journey: Journey; graph: JourneyGraph; version: number | null; versions: { version: number; created_at: string }[] };
export const nodeLabels: Record<NodeType,string> = { start: 'Início',message: 'Mensagem',wait: 'Espera',condition: 'Condição',branch: 'Caminhos',tag: 'Tag',score: 'Pontuação',webhook: 'Webhook',goal: 'Meta',end: 'Fim' };
export const journeyLabels: Record<string,string> = { draft: 'Rascunho',published: 'Publicada',active: 'Ativa',paused: 'Pausada',archived: 'Arquivada' };
export const conditionDefault = () => ({ source: 'lead_score',field: 'score',operator: 'greater_or_equal',value: 50 });
export function newNode(type: NodeType,index: number): JourneyNode {
  const config: Record<string,unknown> = type==='message' ? { messageVersionId: '',connectionId: '',agentId: '' } : type==='wait' ? { mode: 'duration',amount: 1,unit: 'minutes' } : type==='condition' ? conditionDefault() : type==='branch' ? { paths: [{ key: 'qualified',condition: conditionDefault() }] } : type==='tag' ? { action: 'add',tag: '' } : type==='score' ? { action: 'increase',value: 10 } : type==='goal' ? { goal: '',stop: false } : type==='webhook' ? { endpointId: '' } : {};
  return { id: `node_${crypto.randomUUID().replaceAll('-','')}`,type,position: { x: 80+(index%4)*230,y: 80+Math.floor(index/4)*120 },config };
}
export function ports(node: JourneyNode): string[] { return node.type==='end' || node.type==='goal' && node.config.stop===true ? [] : node.type==='condition' ? ['true','false'] : node.type==='branch' ? [...(Array.isArray(node.config.paths) ? node.config.paths.map((p) => String(p.key)) : []),'default'] : ['next']; }
export const journeyHref = (id: string,workspace: string) => `/journeys/${id}?workspace=${encodeURIComponent(workspace)}`;
