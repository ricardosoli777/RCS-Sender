import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { transaction } from '../shared/infrastructure/transaction.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { CampaignInputError } from '../campaigns/contracts.js';

const uuid = { type: 'string',pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' };
const definitions = [
  { table: 'messages',entity: 'message',permission: 'messages.manage',revision: 'current_version',allowed: ['draft','active','archived'] },
  { table: 'campaigns',entity: 'campaign',permission: 'campaigns.manage',revision: 'revision',allowed: ['draft','completed','cancelled','failed'] },
  { table: 'journeys',entity: 'journey',permission: 'journeys.publish',revision: 'revision',allowed: ['draft','published','archived'] },
] as const;

export function registerLibraryDeletionRoutes(app: FastifyInstance,pool: Pool) {
  for (const definition of definitions) app.delete<{ Params: { workspaceId: string; entityId: string }; Body: { expectedRevision: number } }>(`/workspaces/:workspaceId/${definition.table}/:entityId`,{
    config: { permission: definition.permission },bodyLimit: 1024,schema: {
      params: { type: 'object',additionalProperties: false,required: ['workspaceId','entityId'],properties: { workspaceId: uuid,entityId: uuid } },
      body: { type: 'object',additionalProperties: false,required: ['expectedRevision'],properties: { expectedRevision: { type: 'integer',minimum: 1,maximum: 2147483646 } } },
    },
  },async (request,reply) => {
    const context=request.workspaceContext!;
    const result=await transaction(pool,async client => {
      if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
      const role=(await client.query<{ role: string }>("SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u",[context.workspace_id,context.user_id])).rows[0]?.role;
      if (!role) throw new WorkspaceAccessError('not_found');
      if (!['owner','admin','operator'].includes(role)) throw new WorkspaceAccessError('forbidden');
      const row=(await client.query<{ status: string; revision: number }>(`SELECT status,${definition.revision} AS revision FROM ${definition.table} WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,[context.workspace_id,request.params.entityId])).rows[0];
      if (!row) throw new CampaignInputError('not_found');
      if (row.revision!==request.body.expectedRevision) return 'O item mudou. Recarregue antes de excluir.';
      if (!(definition.allowed as readonly string[]).includes(row.status)) return definition.table==='journeys' ? 'Arquive a jornada antes de excluir. Operações já iniciadas podem terminar.' : 'Encerre ou cancele a execução da campanha antes de excluir.';
      if (definition.table==='messages') {
        const used=await client.query(`SELECT 1 FROM campaigns c JOIN message_versions v ON v.workspace_id=c.workspace_id AND v.id=c.message_version_id WHERE c.workspace_id=$1 AND v.message_id=$2 AND c.deleted_at IS NULL AND c.status NOT IN ('completed','cancelled','failed') UNION ALL SELECT 1 FROM journey_nodes n JOIN message_versions m ON m.workspace_id=n.workspace_id AND m.id=n.message_version_id JOIN journey_versions v ON v.workspace_id=n.workspace_id AND v.id=n.version_id JOIN journeys j ON j.workspace_id=v.workspace_id AND j.id=v.journey_id AND j.published_version=v.version WHERE n.workspace_id=$1 AND m.message_id=$2 AND j.deleted_at IS NULL AND j.status IN ('published','active','paused') LIMIT 1`,[context.workspace_id,request.params.entityId]);
        if (used.rowCount) return 'Esta mensagem está vinculada a uma campanha ou jornada. Remova o vínculo ou encerre o fluxo antes de excluir.';
      }
      const lifecycle=definition.table==='messages' ? ",status='archived',active_version=NULL" : definition.table==='journeys' ? ",status='archived',revision=revision+1" : row.status==='draft' ? ",status='cancelled',revision=revision+1" : ',revision=revision+1';
      await client.query(`UPDATE ${definition.table} SET deleted_at=now(),updated_at=now(),updated_by_user_id=$3${lifecycle} WHERE workspace_id=$1 AND id=$2`,[context.workspace_id,request.params.entityId,context.user_id]);
      await client.query('INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[context.workspace_id,context.user_id,`${definition.entity}.deleted`,definition.entity,request.params.entityId,JSON.stringify({ expectedRevision: row.revision,historyPreserved: true })]);
      return null;
    });
    return result ? reply.code(409).send({ message: result }) : reply.code(204).send();
  });
}
