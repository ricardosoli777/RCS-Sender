import { describe,it,expect } from 'vitest';
import { defaultScoreRules,validScoreRules } from './scoring.js';
describe('scoring rules',() => {
  it('accepts defaults and bounded negative adjustments',() => { expect(validScoreRules(defaultScoreRules)).toBe(true); expect(validScoreRules([{ eventType: 'message.read',delta: -2,enabled: true }])).toBe(true); });
  it('rejects feedback loops, duplicates, fractional values and unscoped goals',() => { for (const rules of [[{ eventType: 'lead.score_changed',delta: 1,enabled: true }],[defaultScoreRules[0],defaultScoreRules[0]],[{ eventType: 'message.read',delta: 0.5,enabled: true }],[{ eventType: 'journey.goal_reached',delta: 30,enabled: true }],[{ eventType: 'message.read',delta: 2,enabled: true,goal: 'unused' }]]) expect(validScoreRules(rules)).toBe(false); });
});
