import type {Pool,PoolClient} from 'pg';
import type {CredentialCipher} from '@rcs/security';
import {transaction} from './transaction.js';
import {credentialContext,credentialVersion} from './credentials.js';
import {WorkspaceAccessError,type WorkspaceContext} from './contracts.js';
const targets=[['provider_credentials','ciphertext','connection_id'],['webhook_receipts','ciphertext','id'],['canonical_events','payload_ciphertext','id'],['conversation_messages','content_ciphertext','id'],['webhook_endpoint_versions','config_ciphertext','id'],['journey_webhook_actions','payload_ciphertext','id']] as const;
export class HistoryMaintenance {
  constructor(private readonly pool:Pool,private readonly cipher?:CredentialCipher){}
  private async authorize(client:PoolClient,context:WorkspaceContext){
    if(!(await client.query("SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR UPDATE",[context.workspace_id])).rowCount)throw new WorkspaceAccessError('not_found');
    if(!(await client.query("SELECT m.user_id FROM workspace_members m JOIN users u ON u.id=m.user_id AND u.status='active' AND u.disabled_at IS NULL WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role='owner' FOR SHARE OF m,u",[context.workspace_id,context.user_id])).rowCount)throw new WorkspaceAccessError('forbidden');
  }
  rotate(context:WorkspaceContext){
    if(!this.cipher)throw new Error('Cipher unavailable');
    return transaction(this.pool,async client=>{
      await this.authorize(client,context);const counts:Record<string,number>={};let remaining=0;
      for(const [table,column,idColumn] of targets){
        const rows=(await client.query<Record<string,string>>(`SELECT * FROM ${table} WHERE workspace_id=$1 AND ${column} IS NOT NULL AND split_part(${column},':',2)<>$2 ORDER BY ${idColumn} LIMIT 100 FOR UPDATE`,[context.workspace_id,this.cipher!.activeKeyVersion])).rows;
        for(const row of rows){
          const id=row[idColumn]!;let aad:string;let revision:string|undefined;
          if(table==='provider_credentials'){
            const connection=(await client.query<{id:string;workspace_id:string;provider_id:string;environment:string;revision:string}>("SELECT id,workspace_id,provider_id,environment,EXTRACT(EPOCH FROM updated_at)::text AS revision FROM provider_connections WHERE workspace_id=$1 AND id=$2 FOR UPDATE",[context.workspace_id,id])).rows[0]!;
            aad=credentialContext(connection);revision=connection.revision;
          }else aad=JSON.stringify(table==='webhook_receipts' ? ['webhook-receipt-v1',context.workspace_id,row.connection_id,row.provider_id,id] : table==='canonical_events' ? ['canonical-event-v1',context.workspace_id,id] : table==='conversation_messages' ? ['inbox-message-v1',context.workspace_id,row.conversation_id,id] : table==='webhook_endpoint_versions' ? ['webhook-endpoint-v1',context.workspace_id,id] : ['journey-webhook-v1',context.workspace_id,id]);
          const previous=row[column]!;const plaintext=this.cipher!.decrypt(previous,aad);
          const replacement=revision ? this.cipher!.encryptWithIdentity(plaintext,aad,credentialVersion(previous,revision),revision) : this.cipher!.encrypt(plaintext,aad);
          if(this.cipher!.decrypt(replacement,aad)!==plaintext)throw new Error('Cipher verification failed');
          if(table!=='provider_credentials')await client.query("INSERT INTO cipher_maintenance_permits(target_table,workspace_id,target_id,cipher_column,previous_ciphertext,replacement_ciphertext,operation) VALUES($1,$2,$3,$4,$5,$6,'rotate')",[table,context.workspace_id,id,column,previous,replacement]);
          await client.query(`UPDATE ${table} SET ${column}=$3 WHERE workspace_id=$1 AND ${idColumn}=$2`,[context.workspace_id,id,replacement]);
        }
        counts[table]=rows.length;
        remaining+=Number((await client.query<{count:string}>(`SELECT count(*)::text AS count FROM ${table} WHERE workspace_id=$1 AND ${column} IS NOT NULL AND split_part(${column},':',2)<>$2`,[context.workspace_id,this.cipher!.activeKeyVersion])).rows[0]!.count);
      }
      await client.query('DELETE FROM cipher_maintenance_permits WHERE transaction_id=txid_current()');
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1::uuid,$2,'security.cipher_rotated','workspace',$1::text,$3)",[context.workspace_id,context.user_id,JSON.stringify({counts,remaining,keyVersion:this.cipher!.activeKeyVersion})]);
      return {counts,remaining,keyVersion:this.cipher!.activeKeyVersion};
    });
  }
  compact(context:WorkspaceContext,retainDays=365){
    if(!Number.isSafeInteger(retainDays) || retainDays<30 || retainDays>3650)throw new Error('Invalid retention');
    return transaction(this.pool,async client=>{
      await this.authorize(client,context);
      const rows=(await client.query<{id:string;ciphertext:string}>("SELECT id,ciphertext FROM webhook_receipts WHERE workspace_id=$1 AND status IN ('completed','discarded') AND ciphertext IS NOT NULL AND updated_at<now()-$2*interval '1 day' ORDER BY received_at,id LIMIT 100 FOR UPDATE",[context.workspace_id,retainDays])).rows;
      for(const row of rows){
        await client.query("INSERT INTO cipher_maintenance_permits(target_table,workspace_id,target_id,cipher_column,previous_ciphertext,replacement_ciphertext,operation) VALUES('webhook_receipts',$1,$2,'ciphertext',$3,NULL,'compact')",[context.workspace_id,row.id,row.ciphertext]);
        await client.query('UPDATE webhook_receipts SET ciphertext=NULL WHERE workspace_id=$1 AND id=$2',[context.workspace_id,row.id]);
      }
      await client.query('DELETE FROM cipher_maintenance_permits WHERE transaction_id=txid_current()');
      await client.query('DELETE FROM provider_media_grants WHERE workspace_id=$1 AND expires_at<=now()',[context.workspace_id]);
      await client.query("INSERT INTO audit_logs(workspace_id,actor_user_id,event,entity_type,entity_id,metadata) VALUES($1::uuid,$2,'history.raw_receipts_compacted','workspace',$1::text,$3)",[context.workspace_id,context.user_id,JSON.stringify({count:rows.length,retainDays})]);
      return {compacted:rows.length,retainDays};
    });
  }
}
