import { createHash } from 'node:crypto';
export function credentialVersion(ciphertext: string,revision: string) {
  const parts=ciphertext.split(':');
  if(parts.length===7 && parts[0]==='v2' && /^[a-f0-9]{64}$/.test(parts[5]!) && /^\d+(?:\.\d+)?$/.test(parts[6]!))return parts[6]===revision ? parts[5]! : createHash('sha256').update(JSON.stringify([parts[5],revision])).digest('hex');
  return createHash('sha256').update(JSON.stringify([ciphertext,revision])).digest('hex');
}
export function credentialContext(connection: { workspace_id: string; id: string; provider_id: string; environment: string }) {
  return JSON.stringify(['provider-credentials-v1',connection.workspace_id,connection.id,connection.provider_id,connection.environment]);
}
