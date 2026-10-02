import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password storage', () => {
  it('verifica a senha correta e rejeita outra', async () => {
    const stored = await hashPassword('senha-segura-para-teste');
    expect(await verifyPassword('senha-segura-para-teste', stored)).toBe(true);
    expect(await verifyPassword('senha-errada-para-teste', stored)).toBe(false);
  });

  it('usa sal diferente para a mesma senha', async () => {
    const first = await hashPassword('senha-segura-para-teste');
    const second = await hashPassword('senha-segura-para-teste');
    expect(first).not.toBe(second);
  });

  it('rejeita hashes malformados sem comparar texto puro', async () => {
    expect(await verifyPassword('senha-segura-para-teste', 'senha-segura-para-teste')).toBe(false);
    await expect(hashPassword('curta')).rejects.toThrow();
  });
});
