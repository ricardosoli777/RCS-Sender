import type { CanonicalMessage } from '@rcs/providers';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
export type MessageContent = CanonicalMessage;
export type MessagePurpose = 'marketing' | 'transactional' | 'authentication';
export type MessageStatus = 'draft' | 'active' | 'archived';
export const messageArchetypes={marketing:['launch','offer','promotion','invitation','reengagement','recovery'],transactional:['confirmation','reminder','status_update','appointment'],authentication:['OTP','verification','password_reset']} as const;
export type MessageInput = { name: string; purpose: MessagePurpose; archetype?:string|null; content: MessageContent };
export type Message = { id: string; name: string; purpose: MessagePurpose; status: MessageStatus; current_version: number; active_version: number | null; created_by_user_id: string; updated_by_user_id: string; created_at: Date; updated_at: Date };
export type MessageVersion = MessageInput & { id: string; message_id: string; version: number; created_by_user_id: string; created_at: Date };
export type MessageDetail = { message: Message; current: MessageVersion; active: MessageVersion | null };
export class MessageInputError extends Error { constructor(readonly reason: 'invalid' | 'not_found' | 'conflict') { super('Mensagem indisponível.'); } }
export interface MessageStore {
  create(context: WorkspaceContext,input: MessageInput): Promise<MessageDetail>;
  revise(context: WorkspaceContext,id: string,expectedVersion: number,input: MessageInput): Promise<MessageDetail>;
  changeStatus(context: WorkspaceContext,id: string,expectedVersion: number,status: MessageStatus): Promise<MessageDetail>;
  list(context: WorkspaceContext,offset: number,status?: MessageStatus): Promise<{ messages: Message[]; total: number }>;
  get(context: WorkspaceContext,id: string): Promise<MessageDetail | null>;
  version(context: WorkspaceContext,id: string,version: number): Promise<MessageVersion | null>;
}
