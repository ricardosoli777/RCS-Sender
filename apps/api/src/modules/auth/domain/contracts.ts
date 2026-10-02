export type AuthUser = { id: string; name: string; email: string };
export type LoginUser = AuthUser & { password_hash: string; status: 'active' | 'disabled'; disabled_at: Date | null };
export type Registration = { name: string; email: string; passwordHash: string; workspaceName: string };

export interface AuthStore {
  findUser(email: string): Promise<LoginUser | null>;
  register(input: Registration, tokenHash: Buffer, expiresAt: Date): Promise<AuthUser | null>;
  createSession(user: LoginUser, tokenHash: Buffer, expiresAt: Date): Promise<boolean>;
  findSession(tokenHash: Buffer): Promise<AuthUser | null>;
  revokeSession(tokenHash: Buffer, actorId: string): Promise<void>;
  failedLogin(): Promise<void>;
}
