import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
export type ContactInput = { phone: string; name?: string };
export type Contact = { id: string; phone_normalized: string; name: string; opted_out: boolean };
export type Audience = { id: string; name: string; contact_count: number };
export type ImportResult = { created: number; duplicates: number; optedOut: number; invalidRows: number[] };
export class ContactInputError extends Error { constructor() { super('Dados de contatos inválidos.'); } }
export class ContactListInUseError extends Error { constructor() { super('Lista utilizada por uma campanha.'); } }
export interface ContactStore {
  snapshot(context: WorkspaceContext, offset: number): Promise<{ contacts: Contact[]; lists: Audience[]; total: number }>;
  import(context: WorkspaceContext, contacts: { phone: string; name: string }[], invalidRows: number[], listId?: string): Promise<ImportResult | null>;
  createList(context: WorkspaceContext, name: string): Promise<Audience>;
  deleteList(context: WorkspaceContext, id: string): Promise<boolean>;
  setOptOut(context: WorkspaceContext, id: string): Promise<boolean>;
}
