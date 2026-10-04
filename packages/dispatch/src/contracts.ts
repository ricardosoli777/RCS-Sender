export type WorkspaceContext = Readonly<{ workspace_id: string; user_id: string; role: 'owner' | 'admin' | 'operator' | 'viewer'; permissions: readonly string[] }>;
export type Campaign = { revision: number; execution_mode: string | null; status: string; scheduled_at: Date | null; provider_connection_id: string | null; message_version_id: string | null; audience_list_id: string | null; agent_id: string | null; journey_enrollment_id?: string | null };
export class CampaignInputError extends Error { constructor(readonly reason: 'invalid' | 'not_found' | 'conflict') { super('Campanha indisponível.'); } }
export class WorkspaceAccessError extends Error { constructor(readonly reason: 'not_found' | 'forbidden') { super('Workspace access denied'); } }
