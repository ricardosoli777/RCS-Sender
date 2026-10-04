import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { MessageInputError,type MessageInput,type MessageStatus,type MessageStore } from './contracts.js';
import { validateMessageInput } from './validation.js';
export class MessageService {
  constructor(private readonly store: MessageStore) {}
  create(context: WorkspaceContext,input: MessageInput) { return this.store.create(context,validateMessageInput(input)); }
  revise(context: WorkspaceContext,id: string,expectedVersion: number,input: MessageInput) { return this.store.revise(context,id,expectedVersion,validateMessageInput(input)); }
  changeStatus(context: WorkspaceContext,id: string,expectedVersion: number,status: MessageStatus) { return this.store.changeStatus(context,id,expectedVersion,status); }
  list(context: WorkspaceContext,offset: number,status?: MessageStatus) { return this.store.list(context,offset,status); }
  async get(context: WorkspaceContext,id: string) { const result = await this.store.get(context,id); if (!result) throw new MessageInputError('not_found'); return result; }
  async version(context: WorkspaceContext,id: string,version: number) { const result = await this.store.version(context,id,version); if (!result) throw new MessageInputError('not_found'); return result; }
}
