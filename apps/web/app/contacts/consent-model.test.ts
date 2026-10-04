import { describe,expect,it } from 'vitest';
import { consentError,consentRecord,type ConsentFields,type ConsentSnapshot } from './consent-model';
const now = Date.parse('2026-10-04T12:00:00.000Z');
const snapshot: ConsentSnapshot = { contactId: 'contact',phone: '+5511987654321',optedOut: false,consents: [{ purpose: 'marketing',state: 'granted',revision: 3,source: 'web_form',observedAt: '2026-10-03T10:00:00.000Z' },{ purpose: 'authentication',state: 'unknown',revision: 0,source: null,observedAt: null }] };
const fields: ConsentFields = { purpose: 'marketing',state: 'revoked',source: 'customer_request',evidenceReference: 'record/123',observedUtc: '2026-10-04T10:11:12' };
describe('consent form contract',() => {
  it('binds the selected purpose to its loaded revision and phone with explicit UTC',() => {
    expect(consentRecord(snapshot,fields,now)).toEqual({ purpose: 'marketing',state: 'revoked',source: 'customer_request',evidenceReference: 'record/123',observedAt: '2026-10-04T10:11:12.000Z',expectedRevision: 3,expectedPhone: snapshot.phone });
    expect(consentRecord(snapshot,{ ...fields,purpose: 'authentication',observedUtc: '2026-10-04T10:11' },now)).toMatchObject({ expectedRevision: 0,observedAt: '2026-10-04T10:11:00.000Z' });
  });
  it('rejects dates in the future, normalized invalid dates and observations older than the saved record',() => {
    for (const observedUtc of ['', '2026-10-04T12:00:01','2026-02-31T10:00','2026-10-02T10:00','2026-10-04T10:00Z']) expect(() => consentRecord(snapshot,{ ...fields,observedUtc },now)).toThrow();
  });
  it('requires an evidence reference and never substitutes one automatically',() => {
    for (const evidenceReference of ['', 'contains spaces','x'.repeat(129),'line\nbreak','secret@value']) expect(() => consentRecord(snapshot,{ ...fields,evidenceReference },now)).toThrow('referência');
  });
  it('blocks unloaded purposes and retains opt-out without generating a suppression override',() => {
    expect(() => consentRecord(snapshot,{ ...fields,purpose: 'transactional' },now)).toThrow('Recarregue');
    const payload = consentRecord({ ...snapshot,optedOut: true },{ ...fields,state: 'granted' },now);
    expect(payload).not.toHaveProperty('optedOut'); expect(payload).not.toHaveProperty('clearOptOut'); expect(snapshot.consents[0]?.revision).toBe(3);
  });
  it('requires a read after conflicts and ambiguous transport responses',() => {
    expect(consentError(409)).toContain('Recarregue'); expect(consentError(503)).toContain('antes de tentar novamente'); expect(consentError(403)).toContain('perfil');
  });
});
