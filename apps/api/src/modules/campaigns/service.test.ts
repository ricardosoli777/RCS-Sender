import { describe,expect,it } from 'vitest';
import { validateCampaign } from './service.js';
describe('campaign draft validation',() => {
  const now = Date.parse('2026-10-03T00:00:00.000Z');
  it('permits incomplete drafts and canonicalizes absent references',() => {
    expect(validateCampaign({ name: ' Offer ',objective: ' Recovery ' },now)).toEqual({ name: 'Offer',objective: 'Recovery',providerConnectionId: null,agentId: null,audienceListId: null,messageVersionId: null,scheduledAt: null });
  });
  it('requires canonical future UTC timestamps and rejects invalid calendar dates',() => {
    expect(validateCampaign({ name: 'A',objective: 'B',scheduledAt: '2026-10-04T12:00:00.000Z' },now).scheduledAt).toBe('2026-10-04T12:00:00.000Z');
    for (const scheduledAt of ['2026-10-03T00:00:00.000Z','2027-02-31T00:00:00.000Z','2026-10-04T12:00:00','2026-10-04T12:00:00.000-03:00']) expect(() => validateCampaign({ name: 'A',objective: 'B',scheduledAt },now)).toThrow();
  });
  it('rejects invalid references, blank/control text and extra configuration',() => {
    for (const patch of [{ name: ' ' },{ objective: '\u0000' },{ providerConnectionId: 'foreign-path' },{ agentId: '' },{ sendImmediately: true }]) expect(() => validateCampaign({ name: 'A',objective: 'B',...patch },now)).toThrow();
  });
});
