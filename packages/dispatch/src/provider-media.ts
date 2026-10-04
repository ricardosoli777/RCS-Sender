import { createHash,randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { Media } from '@rcs/providers';
export class ProviderMediaAccess {
  constructor(private readonly pool: Pool,private readonly origin?: string) {}
  async grant(workspaceId: string,connectionId: string,attemptId: string,media: Media) {
    if (!this.origin) throw new Error('Media publication unavailable');
    const origin = new URL(this.origin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Media publication unavailable');
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const result = await this.pool.query<{ mime_type: string; byte_size: number }>(`WITH inserted AS (
      INSERT INTO provider_media_grants(token_hash,workspace_id,connection_id,attempt_id,asset_id,expires_at)
      SELECT $1,a.workspace_id,a.connection_id,a.id,m.id,now()+interval '7 days'
      FROM campaign_dispatch_attempts a JOIN message_version_media v ON v.workspace_id=a.workspace_id AND v.version_id=a.message_version_id AND v.asset_id=$5
      JOIN media_assets m ON m.workspace_id=v.workspace_id AND m.id=v.asset_id AND m.mime_type=$6
      JOIN workspaces w ON w.id=a.workspace_id AND w.status='active'
      WHERE a.workspace_id=$2 AND a.connection_id=$3 AND a.id=$4 AND a.status='sending'
      RETURNING asset_id,workspace_id)
      SELECT m.mime_type,m.byte_size FROM inserted i JOIN media_assets m ON m.workspace_id=i.workspace_id AND m.id=i.asset_id`,[hash,workspaceId,connectionId,attemptId,media.assetId,media.mimeType]);
    const row = result.rows[0];
    if (!row) throw new Error('Media publication unavailable');
    return { url: new URL(`/provider-media/${token}`,origin).href,mimeType: row.mime_type,byteSize: row.byte_size };
  }
  async read(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = createHash('sha256').update(token).digest('hex');
    const row = (await this.pool.query<{ mime_type: string; content: Buffer }>(`SELECT m.mime_type,c.content FROM provider_media_grants g
      JOIN workspaces w ON w.id=g.workspace_id AND w.status='active'
      JOIN provider_connections p ON p.workspace_id=g.workspace_id AND p.id=g.connection_id AND p.status='connected'
      JOIN campaign_dispatch_attempts a ON a.workspace_id=g.workspace_id AND a.id=g.attempt_id AND a.status IN ('sending','accepted','unknown')
      JOIN media_assets m ON m.workspace_id=g.workspace_id AND m.id=g.asset_id
      JOIN media_contents c ON c.workspace_id=m.workspace_id AND c.asset_id=m.id
      WHERE g.token_hash=$1 AND g.expires_at>now()`,[hash])).rows[0];
    return row ? { mimeType: row.mime_type,content: Buffer.from(row.content) } : null;
  }
}
