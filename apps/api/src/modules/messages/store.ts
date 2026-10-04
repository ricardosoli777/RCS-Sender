import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { WorkspaceAccessError } from '../workspaces/application/workspace-service.js';
import { transaction } from '../shared/infrastructure/transaction.js';
import { MessageInputError,type Message,type MessageDetail,type MessageInput,type MessageStatus,type MessageStore,type MessageVersion } from './contracts.js';
const columns = 'id,name,purpose,status,current_version,active_version,created_by_user_id,updated_by_user_id,created_at,updated_at';
const versionColumns = 'id,message_id,version,name,purpose,archetype,content,created_by_user_id,created_at';
export class PgMessageStore implements MessageStore {
  constructor(private readonly pool: Pool) {}
  private async authorize(client: PoolClient,context: WorkspaceContext,write = false) {
    if (!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount) throw new WorkspaceAccessError('not_found');
    const member = (await client.query<{ role: string }>(`SELECT m.role FROM workspace_members m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND u.disabled_at IS NULL FOR SHARE OF m,u`,[context.workspace_id,context.user_id])).rows[0];
    if (!member) throw new WorkspaceAccessError('not_found');
    if (write && !['owner','admin','operator'].includes(member.role)) throw new WorkspaceAccessError('forbidden');
  }
  private async addVersion(client: PoolClient,context: WorkspaceContext,id: string,version: number,input: MessageInput) {
    const saved = (await client.query<MessageVersion>(`INSERT INTO message_versions (workspace_id,message_id,version,name,purpose,content,created_by_user_id,archetype)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${versionColumns}`,[context.workspace_id,id,version,input.name,input.purpose,JSON.stringify(input.content),context.user_id,input.archetype??null])).rows[0]!;
    const mediaItems = input.content.type === 'rich_card' ? (input.content.card.media ? [input.content.card.media] : [])
      : input.content.type === 'carousel' ? input.content.cards.flatMap((card)=>card.media ? [card.media] : [])
      : input.content.type === 'media' || input.content.type === 'file' ? [input.content.media] : [];
    const seen = new Set<string>();
    for (const media of mediaItems) {
      const asset = (await client.query<{ mime_type: string }>('SELECT mime_type FROM media_assets WHERE workspace_id=$1 AND id=$2 FOR SHARE',[context.workspace_id,media.assetId])).rows[0];
      if (!asset || asset.mime_type !== media.mimeType) throw new MessageInputError('invalid');
      if (!seen.has(media.assetId)) await client.query('INSERT INTO message_version_media (workspace_id,version_id,asset_id) VALUES ($1,$2,$3)',[context.workspace_id,saved.id,media.assetId]);
      seen.add(media.assetId);
    }
    return saved;
  }
  private audit(client: PoolClient,context: WorkspaceContext,id: string,event: string,version: number) {
    return client.query(`INSERT INTO audit_logs (workspace_id,actor_user_id,event,entity_type,entity_id,metadata)
      VALUES ($1,$2,$3,'message',$4,$5)`,[context.workspace_id,context.user_id,event,id,JSON.stringify({ version })]);
  }
  private async detail(client: PoolClient,context: WorkspaceContext,message: Message): Promise<MessageDetail> {
    const versions = (await client.query<MessageVersion>(`SELECT ${versionColumns} FROM message_versions WHERE workspace_id=$1 AND message_id=$2 AND version=ANY($3::int[])`,[context.workspace_id,message.id,[message.current_version,message.active_version].filter((value) => value !== null)])).rows;
    return { message,current: versions.find((row) => row.version === message.current_version)!,active: versions.find((row) => row.version === message.active_version) ?? null };
  }
  create(context: WorkspaceContext,input: MessageInput) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true);
      const message = (await client.query<Message>(`INSERT INTO messages (id,workspace_id,name,purpose,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$5) RETURNING ${columns}`,[randomUUID(),context.workspace_id,input.name,input.purpose,context.user_id])).rows[0]!;
      const current = await this.addVersion(client,context,message.id,1,input); await this.audit(client,context,message.id,'message.created',1);
      return { message,current,active: null };
    });
  }
  revise(context: WorkspaceContext,id: string,expectedVersion: number,input: MessageInput) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true);
      const current = (await client.query<Message>(`SELECT ${columns} FROM messages WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[context.workspace_id,id])).rows[0];
      if (!current) throw new MessageInputError('not_found');
      if (current.current_version !== expectedVersion || current.status === 'archived') throw new MessageInputError('conflict');
      if (current.current_version >= 2147483647) throw new MessageInputError('conflict');
      const next = current.current_version+1; await this.addVersion(client,context,id,next,input);
      const message = (await client.query<Message>(`UPDATE messages SET name=$3,purpose=$4,current_version=$5,updated_by_user_id=$6,updated_at=now()
        WHERE workspace_id=$1 AND id=$2 RETURNING ${columns}`,[context.workspace_id,id,input.name,input.purpose,next,context.user_id])).rows[0]!;
      await this.audit(client,context,id,'message.revised',next); return this.detail(client,context,message);
    });
  }
  changeStatus(context: WorkspaceContext,id: string,expectedVersion: number,status: MessageStatus) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context,true);
      const current = (await client.query<Message>(`SELECT ${columns} FROM messages WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[context.workspace_id,id])).rows[0];
      if (!current) throw new MessageInputError('not_found');
      if (current.current_version !== expectedVersion || (current.status === 'archived' && status === 'active')) throw new MessageInputError('conflict');
      const message = (await client.query<Message>(`UPDATE messages SET status=$3,active_version=$4,updated_by_user_id=$5,updated_at=now()
        WHERE workspace_id=$1 AND id=$2 RETURNING ${columns}`,[context.workspace_id,id,status,status === 'active' ? current.current_version : null,context.user_id])).rows[0]!;
      await this.audit(client,context,id,`message.${status}`,current.current_version); return this.detail(client,context,message);
    });
  }
  list(context: WorkspaceContext,offset: number,status?: MessageStatus) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const messages = (await client.query<Message>(`SELECT ${columns} FROM messages WHERE workspace_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at,id LIMIT 50 OFFSET $3`,[context.workspace_id,status ?? null,offset])).rows;
      const total = (await client.query<{ total: number }>('SELECT count(*)::int AS total FROM messages WHERE workspace_id=$1 AND ($2::text IS NULL OR status=$2)',[context.workspace_id,status ?? null])).rows[0]!.total;
      return { messages,total };
    });
  }
  get(context: WorkspaceContext,id: string) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      const message = (await client.query<Message>(`SELECT ${columns} FROM messages WHERE workspace_id=$1 AND id=$2`,[context.workspace_id,id])).rows[0];
      return message ? this.detail(client,context,message) : null;
    });
  }
  version(context: WorkspaceContext,id: string,version: number) {
    return transaction(this.pool,async (client) => {
      await this.authorize(client,context);
      return (await client.query<MessageVersion>(`SELECT ${versionColumns} FROM message_versions WHERE workspace_id=$1 AND message_id=$2 AND version=$3`,[context.workspace_id,id,version])).rows[0] ?? null;
    });
  }
}
