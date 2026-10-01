import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCipher } from './index.js';

describe('CredentialCipher', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const oldCipher = new CredentialCipher('old', { old: oldKey });
  const current = new CredentialCipher('new', { old: oldKey, new: newKey });

  it('decifra apenas no contexto original', () => {
    const encrypted = current.encrypt('token-secreto', 'provider-connection:123');
    expect(current.decrypt(encrypted, 'provider-connection:123')).toBe('token-secreto');
    expect(() => current.decrypt(encrypted, 'provider-connection:456')).toThrow('Não foi possível');
  });

  it('rejeita adulteração do ciphertext', () => {
    const encrypted = current.encrypt('token-secreto', 'connection:1');
    const parts = encrypted.split(':');
    parts[4] = parts[4] === 'A' ? 'B' : 'A';
    expect(() => current.decrypt(parts.join(':'), 'connection:1')).toThrow('Não foi possível');
  });

  it('recriptografa dados antigos com a chave ativa', () => {
    const old = oldCipher.encrypt('credencial', 'connection:1');
    const rotated = current.rotate(old, 'connection:1');
    expect(rotated.startsWith('v1:new:')).toBe(true);
    expect(current.decrypt(rotated, 'connection:1')).toBe('credencial');
    expect(() => oldCipher.decrypt(rotated, 'connection:1')).toThrow('Não foi possível');
  });

  it('rejeita chaves de tamanho incorreto', () => {
    expect(() => new CredentialCipher('x', { x: randomBytes(16) })).toThrow();
  });
});

