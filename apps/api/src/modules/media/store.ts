import type { Pool,PoolClient } from 'pg';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { transaction } from '../shared/infrastructure/transaction.js';
import type { MediaAsset,MediaStore,ValidatedImage } from './contracts.js';
const columns = 'id,name,mime_type,byte_size,width,height,sha256,created_at';
export class PgMediaStore implements MediaStore {
  constructor(private readonly pool: Pool) {}
  private async authorize(client: PoolClient, context: WorkspaceContext, write = false) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0];
    if (!member) throw new WorkspaceAccessError('not_found');
    if (write && !['owner','admin','operator'].includes(member.role)) throw new WorkspaceAccessError('forbidden');
  }
  authorizeUpload(context: WorkspaceContext) { return transaction(this.pool,(client) => this.authorize(client,context,true)); }
  create(context: WorkspaceContext, image: ValidatedImage) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true);
      const asset = (await client.query<MediaAsset>(`INSERT INTO media_assets (workspace_id,name,mime_type,byte_size,width,height,sha256,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,[context.workspace_id,image.name,image.mimeType,image.content.length,image.width,image.height,image.sha256,context.user_id])).rows[0]!;
      await client.query('INSERT INTO media_contents (workspace_id,asset_id,content) VALUES ($1,$2,$3)',[context.workspace_id,asset.id,image.content]);
      await client.query(`INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata)
        VALUES ($1,$2,'media.created','media_asset',$3,$4)`,[context.workspace_id,context.user_id,asset.id,JSON.stringify({ mimeType: image.mimeType,byteSize: image.content.length })]);
      return asset;
    });
  }
  list(context: WorkspaceContext, offset: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const assets = await client.query<MediaAsset>(`SELECT ${columns} FROM media_assets WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 50 OFFSET $2`,[context.workspace_id,offset]);
      const total = (await client.query<{ total: number }>('SELECT count(*)::int AS total FROM media_assets WHERE workspace_id=$1',[context.workspace_id])).rows[0]!.total;
      return { assets: assets.rows,total };
    });
  }
  get(context: WorkspaceContext, id: string) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const asset = (await client.query<MediaAsset>(`SELECT ${columns} FROM media_assets WHERE workspace_id=$1 AND id=$2`,[context.workspace_id,id])).rows[0];
      if (!asset) return null;
      const content = (await client.query<{ content: Buffer }>('SELECT content FROM media_contents WHERE workspace_id=$1 AND asset_id=$2',[context.workspace_id,id])).rows[0]?.content;
      if (!content) throw new Error('Media content unavailable');
      return { asset,content: Buffer.from(content) };
    });
  }
}
