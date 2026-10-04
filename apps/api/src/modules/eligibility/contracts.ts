import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
export type EligibilityStatus = 'eligible' | 'ineligible' | 'unknown' | 'blocked';
export type EligibilityReason = 'checking' | 'provider_checked' | 'unsupported' | 'provider_unavailable' | 'opted_out' | 'connection_unavailable' | 'contact_changed';
export type EligibilityResult = { status: EligibilityStatus; reason: EligibilityReason; checkedAt: Date; expiresAt: Date };
export type EligibilityContact = { id: string; phone: string; optedOut: boolean };
export class EligibilityInputError extends Error {
  constructor(readonly reason: 'not_found' | 'stale') { super('Consulta de elegibilidade indisponível.'); }
}
export interface EligibilityStore {
  contact(context: WorkspaceContext, id: string): Promise<EligibilityContact | null>;
  begin(context: WorkspaceContext, connectionId: string, contactId: string, version: string, expectedPhone: string): Promise<string | null>;
  save(context: WorkspaceContext, connectionId: string, contactId: string, version: string, attemptId: string, result: Pick<EligibilityResult, 'status' | 'reason'>): Promise<EligibilityResult | null>;
}
