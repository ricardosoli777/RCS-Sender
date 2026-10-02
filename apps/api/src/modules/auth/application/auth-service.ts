import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '@rcs/security';
import type { AuthStore, AuthUser } from '../domain/contracts.js';

export const SESSION_SECONDS = 8 * 60 * 60;
export const hashToken = (token: string) => createHash('sha256').update(token).digest();
export type AuthResult = { user: AuthUser; token: string };

export class AuthService {
  private dummyHash: Promise<string> | undefined;
  constructor(private readonly store: AuthStore) {}

  async login(email: string, password: string): Promise<AuthResult | null> {
    const user = await this.store.findUser(email.trim().toLowerCase());
    const passwordHash = user?.password_hash ?? await (this.dummyHash ??= hashPassword(randomBytes(32).toString('base64url')));
    const valid = await verifyPassword(password, passwordHash);
    if (!valid || !user || user.disabled_at || user.status !== 'active') {
      await this.store.failedLogin();
      return null;
    }
    const token = randomBytes(32).toString('base64url');
    if (!await this.store.createSession(user, hashToken(token), new Date(Date.now() + SESSION_SECONDS * 1000))) {
      await this.store.failedLogin();
      return null;
    }
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

  async register(input: { name: string; email: string; password: string; workspaceName: string }): Promise<AuthResult | null> {
    if (Buffer.byteLength(input.password, 'utf8') < 12 || Buffer.byteLength(input.password, 'utf8') > 1024) return null;
    const token = randomBytes(32).toString('base64url');
    const user = await this.store.register({ name: input.name.trim(), email: input.email.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password), workspaceName: input.workspaceName.trim() },
    hashToken(token), new Date(Date.now() + SESSION_SECONDS * 1000));
    return user ? { user, token } : null;
  }
}
