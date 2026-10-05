import type { Pool,PoolClient } from 'pg';
import { validateMessage,type CanonicalMessage,type ProviderRegistry } from '@rcs/providers';
import { transaction } from './transaction.js';
import { WorkspaceAccessError,type WorkspaceContext } from './contracts.js';
import { validateGraph,type JourneyGraph,type GraphIssue } from './journey-graph.js';
export class JourneyInputError extends Error { constructor(readonly reason: 'invalid' | 'not_found' | 'conflict') { super('Jornada indisponível.'); } }
export type Journey = { id: string; name: string; status: 'draft' | 'published' | 'active' | 'paused' | 'archived'; revision: number; draft_graph: JourneyGraph; published_version: number | null };
const columns = 'id,name,status,revision,draft_graph,published_version';
const initialGraph: JourneyGraph = { nodes: [{ id: 'start',type: 'start',position: { x: 100,y: 100 },config: {} },{ id: 'end',type: 'end',position: { x: 400,y: 100 },config: {} }],edges: [{ id: 'start-end',source: 'start',target: 'end',port: 'next' }],viewport: { x: 0,y: 0,zoom: 1 } };
export class JourneyService {
  constructor(private readonly pool: Pool,private readonly registry: ProviderRegistry) {}
  async authorize(client: PoolClient,context: WorkspaceContext,write = false) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const role = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id AND u.status='active' AND u.disabled_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0]?.role;
    if (!role) throw new WorkspaceAccessError('not_found'); if (write && !['owner','admin','operator'].includes(role)) throw new WorkspaceAccessError('forbidden');
  }
  private audit(client: PoolClient,context: WorkspaceContext,id: string,event: string,metadata: object) { return client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,$2,$3,'journey',$4,$5)",[context.workspace_id,context.user_id,event,id,JSON.stringify(metadata)]); }
  private name(value: unknown): string { if (typeof value!=='string' || !value.trim() || value.trim().length>100) throw new JourneyInputError('invalid'); return value.trim(); }
  list(context: WorkspaceContext,offset = 0) {
    if (!Number.isInteger(offset) || offset<0 || offset>1000000) throw new JourneyInputError('invalid');
    return transaction(this.pool,async (client) => { await this.authorize(client,context); const rows = await client.query<Omit<Journey,'draft_graph'>>('SELECT id,name,status,revision,published_version FROM journeys WHERE deleted_at IS NULL AND workspace_id=$1 ORDER BY created_at DESC,id LIMIT 50 OFFSET $2',[context.workspace_id,offset]); const total = (await client.query<{ total: number }>('SELECT count(*)::int AS total FROM journeys WHERE deleted_at IS NULL AND workspace_id=$1',[context.workspace_id])).rows[0]!.total; return { journeys: rows.rows,total }; });
  }
  create(context: WorkspaceContext,name: string) {
    const normalized = this.name(name);
    return transaction(this.pool,async (client) => { await this.authorize(client,context,true); const journey = (await client.query<Journey>(`INSERT INTO journeys(workspace_id,name,draft_graph,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$4) RETURNING ${columns}`,[context.workspace_id,normalized,JSON.stringify(initialGraph),context.user_id])).rows[0]!; await this.audit(client,context,journey.id,'journey.created',{}); return journey; });
  }
  private async load(client: PoolClient,context: WorkspaceContext,id: string): Promise<Journey> { const row = (await client.query<Journey>(`SELECT ${columns} FROM journeys WHERE deleted_at IS NULL AND workspace_id=$1 AND id=$2 FOR UPDATE`,[context.workspace_id,id])).rows[0]; if (!row) throw new JourneyInputError('not_found'); return row; }
  get(context: WorkspaceContext,id: string,version?: number) {
    return transaction(this.pool,async (client) => { await this.authorize(client,context); const journey = await this.load(client,context,id); const versions = (await client.query<{ id: string; version: number; published_at: Date }>('SELECT id,version,published_at FROM journey_versions WHERE workspace_id=$1 AND journey_id=$2 ORDER BY version DESC LIMIT 50',[context.workspace_id,id])).rows; if (version!==undefined) { if (!Number.isInteger(version) || version<1) throw new JourneyInputError('invalid'); const selected = (await client.query<{ graph: JourneyGraph }>('SELECT graph FROM journey_versions WHERE workspace_id=$1 AND journey_id=$2 AND version=$3',[context.workspace_id,id,version])).rows[0]; if (!selected) throw new JourneyInputError('not_found'); return { journey,graph: selected.graph,version,versions }; } return { journey,graph: journey.draft_graph,version: null,versions }; });
  }
  save(context: WorkspaceContext,id: string,revision: number,name: string,graph: unknown) {
    const normalized = this.name(name); if (Buffer.byteLength(JSON.stringify(graph) ?? '')>262144 || validateGraph(graph).some((issue) => issue.code==='invalid_graph')) throw new JourneyInputError('invalid');
    return transaction(this.pool,async (client) => { await this.authorize(client,context,true); const current = await this.load(client,context,id); if (current.revision!==revision || current.status==='archived') throw new JourneyInputError('conflict'); const journey = (await client.query<Journey>(`UPDATE journeys SET name=$3,draft_graph=$4,revision=revision+1,updated_by_user_id=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${columns}`,[context.workspace_id,id,normalized,JSON.stringify(graph),context.user_id])).rows[0]!; await this.audit(client,context,id,'journey.draft_saved',{ revision: journey.revision }); return journey; });
  }
  private async issues(client: PoolClient,context: WorkspaceContext,graph: JourneyGraph): Promise<GraphIssue[]> {
    const issues = validateGraph(graph); if (issues.length) return issues;
    for (const node of graph.nodes) {
      if (node.type==='webhook') { if (!(await client.query("SELECT id FROM webhook_endpoints WHERE workspace_id=$1 AND id=$2 AND status='active'",[context.workspace_id,node.config.endpointId])).rowCount) issues.push({ code: 'webhook_not_configured',nodeId: node.id }); continue; }
      const conditions = node.type==='condition' ? [node.config] : node.type==='branch' && Array.isArray(node.config.paths) ? node.config.paths.map((path) => (path as { condition: Record<string,unknown> }).condition) : [];
      for (const condition of conditions.filter((condition) => condition.source==='message_event')) {
        const requiredEvent=condition.field==='actionPayload'?'action.selected':condition.field;
        const providers = graph.nodes.filter((candidate) => candidate.type==='message');
        if (!providers.length) issues.push({ code: 'event_capability_unproven',nodeId: node.id });
        for (const provider of providers) { const connection = (await client.query<{ provider_id: string }>('SELECT provider_id FROM provider_connections WHERE workspace_id=$1 AND id=$2',[context.workspace_id,provider.config.connectionId])).rows[0]; const descriptor = connection && this.registry.describe(connection.provider_id); if (!descriptor?.active || !descriptor.events?.some((event) => event===requiredEvent)) issues.push({ code: 'event_capability_unproven',nodeId: node.id }); }
      }
      if (node.type!=='message') continue;
      const message = (await client.query<{ content: CanonicalMessage }>(`SELECT v.content FROM message_versions v JOIN messages m ON m.workspace_id=v.workspace_id AND m.id=v.message_id WHERE v.workspace_id=$1 AND v.id=$2 AND m.status='active' AND m.active_version=v.version FOR SHARE OF v,m`,[context.workspace_id,node.config.messageVersionId])).rows[0];
      const connection = (await client.query<{ provider_id: string; external_agent_id: string | null; status: string }>('SELECT provider_id,external_agent_id,status FROM provider_connections WHERE workspace_id=$1 AND id=$2 FOR SHARE',[context.workspace_id,node.config.connectionId])).rows[0];
      const descriptor = connection && this.registry.describe(connection.provider_id);
      if (!message || !connection || connection.status!=='connected' || connection.external_agent_id!==node.config.agentId || !descriptor?.active || descriptor.capabilities.eligibility!=='supported' || validateMessage(message.content,descriptor.capabilities,descriptor.limits).length) issues.push({ code: 'message_reference_unavailable',nodeId: node.id });
    }
    return issues;
  }
  validate(context: WorkspaceContext,id: string) { return transaction(this.pool,async (client) => { await this.authorize(client,context); const journey = await this.load(client,context,id); return { revision: journey.revision,issues: await this.issues(client,context,journey.draft_graph) }; }); }
  publish(context: WorkspaceContext,id: string,revision: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true); const journey = await this.load(client,context,id); if (journey.revision!==revision || journey.status==='archived' || (await this.issues(client,context,journey.draft_graph)).length) throw new JourneyInputError('conflict');
      const version = (journey.published_version ?? 0)+1; const graph = journey.draft_graph;
      for (const node of graph.nodes.filter((node) => node.type==='webhook')) { const endpoint = (await client.query<{ id: string }>('SELECT v.id FROM webhook_endpoint_versions v JOIN webhook_endpoints e ON e.workspace_id=v.workspace_id AND e.id=v.endpoint_id AND e.active_version=v.version WHERE e.workspace_id=$1 AND e.id=$2',[context.workspace_id,node.config.endpointId])).rows[0]!; node.config={ endpointId: node.config.endpointId,endpointVersionId: endpoint.id }; }
      const snapshot = (await client.query<{ id: string }>('INSERT INTO journey_versions(workspace_id,journey_id,version,graph,published_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[context.workspace_id,id,version,JSON.stringify(graph),context.user_id])).rows[0]!;
      for (const node of graph.nodes) await client.query('INSERT INTO journey_nodes(workspace_id,version_id,node_id,node_type,config,position,message_version_id,connection_id,webhook_endpoint_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[context.workspace_id,snapshot.id,node.id,node.type,JSON.stringify(node.config),JSON.stringify(node.position),node.type==='message' ? node.config.messageVersionId : null,node.type==='message' ? node.config.connectionId : null,node.type==='webhook' ? node.config.endpointVersionId : null]);
      for (const edge of graph.edges) await client.query('INSERT INTO journey_edges(workspace_id,version_id,edge_id,source_node_id,target_node_id,port) VALUES($1,$2,$3,$4,$5,$6)',[context.workspace_id,snapshot.id,edge.id,edge.source,edge.target,edge.port]);
      await client.query("UPDATE journeys SET published_version=$3,status=CASE WHEN status IN ('active','paused') THEN status ELSE 'published' END,revision=revision+1,updated_by_user_id=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2",[context.workspace_id,id,version,context.user_id]);
      await this.audit(client,context,id,'journey.published',{ version,revision: revision+1 }); return { version,versionId: snapshot.id,revision: revision+1 };
    });
  }
  control(context: WorkspaceContext,id: string,revision: number,action: 'activate' | 'pause' | 'resume' | 'archive') {
    return transaction(this.pool,async (client) => { await this.authorize(client,context,true); const journey = await this.load(client,context,id); const status = action==='archive' && journey.status!=='archived' ? 'archived' : action==='pause' && journey.status==='active' ? 'paused' : action==='resume' && journey.status==='paused' ? 'active' : action==='activate' && journey.status==='published' && journey.published_version ? 'active' : null; if (!status || journey.revision!==revision) throw new JourneyInputError('conflict'); await client.query('UPDATE journeys SET status=$3,revision=revision+1,updated_by_user_id=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2',[context.workspace_id,id,status,context.user_id]); await this.audit(client,context,id,'journey.status_changed',{ status,revision: revision+1 }); return { status,revision: revision+1 }; });
  }
}
