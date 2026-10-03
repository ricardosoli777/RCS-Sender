export type Role = 'owner' | 'admin' | 'operator' | 'viewer';
export const roleNames: Record<Role, string> = { owner: 'Proprietário', admin: 'Administrador', operator: 'Operador', viewer: 'Leitor' };
