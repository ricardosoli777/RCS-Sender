import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { CampaignInputError,type CampaignDraft,type CampaignInput,type CampaignOptionKind,type CampaignStatus,type CampaignStore } from './contracts.js';
const uuid = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
export function validateCampaign(input: CampaignInput,now = Date.now()): CampaignDraft {
  if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !['name','objective','providerConnectionId','agentId','audienceListId','messageVersionId','scheduledAt'].includes(key))) throw new CampaignInputError('invalid');
  for (const [value,max] of [[input.name,100],[input.objective,500]] as const) if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max || /[\x00-\x1f\x7f]/.test(value)) throw new CampaignInputError('invalid');
  for (const value of [input.providerConnectionId,input.audienceListId,input.messageVersionId]) if (value != null && (typeof value !== 'string' || !uuid.test(value))) throw new CampaignInputError('invalid');
  if (input.agentId != null && (typeof input.agentId !== 'string' || !input.agentId.trim() || Array.from(input.agentId).length > 128 || /[\x00-\x1f\x7f]/.test(input.agentId))) throw new CampaignInputError('invalid');
  if (input.scheduledAt != null) {
    if (typeof input.scheduledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.scheduledAt)) throw new CampaignInputError('invalid');
    const date = new Date(input.scheduledAt); if (!Number.isFinite(date.getTime()) || date.getTime() <= now || date.toISOString() !== input.scheduledAt) throw new CampaignInputError('invalid');
  }
  return { name: input.name.trim(),objective: input.objective.trim(),providerConnectionId: input.providerConnectionId ?? null,agentId: input.agentId?.trim() ?? null,audienceListId: input.audienceListId ?? null,messageVersionId: input.messageVersionId ?? null,scheduledAt: input.scheduledAt ?? null };
}
export class CampaignService {
  constructor(private readonly store: CampaignStore) {}
  options(context: WorkspaceContext,kind: CampaignOptionKind,offset: number) { return this.store.options(context,kind,offset); }
  create(context: WorkspaceContext,input: CampaignInput) { return this.store.create(context,validateCampaign(input)); }
  revise(context: WorkspaceContext,id: string,revision: number,input: CampaignInput) { return this.store.revise(context,id,revision,validateCampaign(input)); }
  cancel(context: WorkspaceContext,id: string,revision: number) { return this.store.cancel(context,id,revision); }
  list(context: WorkspaceContext,offset: number,status?: CampaignStatus) { return this.store.list(context,offset,status); }
  async get(context: WorkspaceContext,id: string) { const campaign = await this.store.get(context,id); if (!campaign) throw new CampaignInputError('not_found'); return campaign; }
  review(context: WorkspaceContext,id: string) { return this.store.review(context,id); }
}
