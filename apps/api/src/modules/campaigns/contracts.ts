import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import type { CachedEligibilityCounts } from './eligibility-review.js';
export const campaignStatuses = ['draft','scheduled','ready','queued','running','paused','completed','cancelled','failed'] as const;
export type CampaignStatus = typeof campaignStatuses[number];
export type CampaignInput = { name: string; objective: string; providerConnectionId?: string | null; agentId?: string | null; audienceListId?: string | null; messageVersionId?: string | null; scheduledAt?: string | null };
export type CampaignDraft = Required<CampaignInput>;
export type Campaign = { id: string; name: string; objective: string; status: CampaignStatus; revision: number; execution_mode: 'simulation' | 'dispatch' | null; provider_connection_id: string | null; agent_id: string | null; audience_list_id: string | null; message_version_id: string | null; scheduled_at: Date | null; created_at: Date; updated_at: Date };
export type CampaignReview = { campaign: Campaign; audience: { total: number; optedOut: number; remaining: number }; eligibility: { source: 'saved_checks'; checkedAt: Date; counts: CachedEligibilityCounts }; message: { id: string; message_id: string; version: number } | null; issues: string[]; executionAvailable: false };
export type CampaignOptionKind = 'connections' | 'audiences' | 'messages';
export type CampaignOption = { id: string; name: string; agentId?: string | null; status?: string; contactCount?: number; messageId?: string; version?: number };
export { CampaignInputError } from '@rcs/dispatch';
export interface CampaignStore {
  options(context: WorkspaceContext,kind: CampaignOptionKind,offset: number): Promise<{ options: CampaignOption[]; total: number }>;
  create(context: WorkspaceContext,input: CampaignDraft): Promise<Campaign>;
  revise(context: WorkspaceContext,id: string,expectedRevision: number,input: CampaignDraft): Promise<Campaign>;
  cancel(context: WorkspaceContext,id: string,expectedRevision: number): Promise<Campaign>;
  list(context: WorkspaceContext,offset: number,status?: CampaignStatus): Promise<{ campaigns: Campaign[]; total: number }>;
  get(context: WorkspaceContext,id: string): Promise<Campaign | null>;
  review(context: WorkspaceContext,id: string): Promise<CampaignReview>;
}
