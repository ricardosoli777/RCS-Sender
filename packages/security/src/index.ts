import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export { hashPassword, verifyPassword } from './password.js';

const FORMAT = 'v1';
const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type EncryptionKeys = Readonly<Record<string, Buffer>>;

function decodePart(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Ciphertext inválido');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('Ciphertext inválido');
  return decoded;
}

export class CredentialCipher {
  get activeKeyVersion(){return this.activeVersion;}
  encryptWithIdentity(plaintext:string,context:string,identity:string,revision:string){
    if(!/^[a-f0-9]{64}$/.test(identity) || !/^\d+(?:\.\d+)?$/.test(revision))throw new Error('Identidade de cifra inválida');
    const value=this.encrypt(plaintext,JSON.stringify(['cipher-identity-v2',context,identity,revision])).split(':');
    value[0]='v2';return [...value,identity,revision].join(':');
  }
  constructor(private readonly activeVersion: string, private readonly keys: EncryptionKeys) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(activeVersion)) throw new Error('Versão de chave inválida');
    if (!keys[activeVersion]) throw new Error('Chave ativa ausente');
    for (const [version, key] of Object.entries(keys)) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(version) || key.length !== 32) {
        throw new Error('Chave de criptografia inválida');
      }
    }
  }

  encrypt(plaintext: string, context: string): string {
    if (!context) throw new Error('Contexto de criptografia obrigatório');
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keys[this.activeVersion]!, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [FORMAT, this.activeVersion, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  decrypt(serialized: string, context: string): string {
    if (!context) throw new Error('Contexto de criptografia obrigatório');
    try {
      const parts = serialized.split(':');
      if(parts[0]==='v2'){
        if(parts.length!==7 || !/^[a-f0-9]{64}$/.test(parts[5]!) || !/^\d+(?:\.\d+)?$/.test(parts[6]!))throw new Error('Formato inválido');
        context=JSON.stringify(['cipher-identity-v2',context,parts[5],parts[6]]);
      }else if (parts.length !== 5 || parts[0] !== FORMAT) throw new Error('Formato inválido');
      const [, version, nonceText, tagText, ciphertextText] = parts;
      const key = this.keys[version!];
      if (!key) throw new Error('Chave indisponível');
      const nonce = decodePart(nonceText!);
      const tag = decodePart(tagText!);
      const ciphertext = decodePart(ciphertextText!);
      if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new Error('Tamanho inválido');
      const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Não foi possível decifrar a credencial');
    }
  }

  rotate(serialized: string, context: string): string {
    return this.encrypt(this.decrypt(serialized, context), context);
  }
}
