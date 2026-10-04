import { capabilities,eventTypes,type RcsProvider,type ProviderMetadata,type CapabilityMatrix,type ProviderLimits } from './contracts.js';
export const activationChecks = ['documentationReviewed', 'evidenceRecorded', 'contractTestsPassed', 'connectionTestPassed', 'credentialHandlingValidated', 'webhookValidationTested'] as const;
export type ProviderEvidence = Readonly<{ documentPath: string; reviewedAt: string; references: readonly string[]; checks: Readonly<Record<typeof activationChecks[number], boolean>> }>;
export type ProviderDescriptor = Readonly<{ metadata: ProviderMetadata; capabilities: CapabilityMatrix; limits: ProviderLimits; active: boolean; evidence: ProviderEvidence; events: readonly typeof eventTypes[number][] }>;

export class ProviderRegistry {
  private readonly entries = new Map<string, { adapter: RcsProvider; descriptor: ProviderDescriptor }>();
  register(adapter: RcsProvider, evidence: ProviderEvidence) {
    const metadata = adapter.getProviderMetadata();
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(metadata.id) || this.entries.has(metadata.id)) throw new Error('Identificador de provedor inválido ou duplicado');
    const keys = metadata.credentialSchema.map((field) => field.key);
    if (new Set(keys).size !== keys.length || keys.some((key) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Schema de credenciais inválido');
    if (!metadata.environments.length || new Set(metadata.environments).size !== metadata.environments.length) throw new Error('Ambientes inválidos');
    const supportedEvents = adapter.getSupportedEvents?.() ?? [];
    if (new Set(supportedEvents).size!==supportedEvents.length || supportedEvents.some((event) => !eventTypes.includes(event))) throw new Error('Eventos declarados inválidos');
    const snapshot = structuredClone({ metadata, capabilities: adapter.getProviderCapabilities(), limits: adapter.getProviderLimits(), evidence,events: supportedEvents });
    if (capabilities.some((key) => !['supported', 'unsupported', 'unknown'].includes(snapshot.capabilities[key]))) throw new Error('Matriz de capacidades inválida');
    if (Object.values(snapshot.limits).some((limit) => limit !== undefined && (!Number.isFinite(limit) || limit < 0))) throw new Error('Limites inválidos');
    const optionalMethods = { eligibility: 'checkEligibility', recipient_capabilities: 'getCapabilities', revoke: 'revoke', message_status: 'getMessageStatus', cost_estimation: 'estimateCost', billing: 'normalizeBillingData' } as const;
    for (const [capability, method] of Object.entries(optionalMethods)) {
      if (snapshot.capabilities[capability as keyof typeof optionalMethods] === 'supported' && typeof adapter[method] !== 'function') throw new Error('Capacidade sem implementação');
    }
    const reviewed = new Date(evidence.reviewedAt);
    const active = activationChecks.every((key) => evidence.checks[key] === true) && /^\d{4}-\d{2}-\d{2}$/.test(evidence.reviewedAt)
      && !Number.isNaN(reviewed.getTime()) && reviewed.toISOString().slice(0, 10) === evidence.reviewedAt
      && evidence.documentPath.startsWith('docs/providers/') && evidence.references.length > 0
      && evidence.references.every((reference) => { try { const url = new URL(reference); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } });
    this.entries.set(metadata.id, { adapter, descriptor: { ...snapshot, active } });
  }
  list(): readonly ProviderDescriptor[] { return [...this.entries.values()].map((entry) => structuredClone(entry.descriptor)); }
  resolve(id: string): RcsProvider {
    const entry = this.entries.get(id);
    if (!entry?.descriptor.active) throw new Error('Provedor indisponível');
    return entry.adapter;
  }
  // Bootstrap authentication is available before activation; this exposes no send operation.
  webhookChallenge(id: string) {
    const adapter = this.entries.get(id)?.adapter;
    return adapter?.verifyWebhookChallenge?.bind(adapter);
  }
  describe(id: string): ProviderDescriptor | null { const value = this.entries.get(id)?.descriptor; return value ? structuredClone(value) : null; }
}
