import { validCondition } from './journey-graph.js';
export type ConditionContext = Record<string,unknown>;
function lookup(value: unknown,path: string): unknown {
  if (!value || typeof value!=='object' || Array.isArray(value)) return undefined;
  if (Object.hasOwn(value,path)) return (value as Record<string,unknown>)[path];
  let current: unknown = value;
  for (const part of path.split('.')) { if (!current || typeof current!=='object' || Array.isArray(current) || !Object.hasOwn(current,part)) return undefined; current = (current as Record<string,unknown>)[part]; }
  return current;
}
export function evaluateCondition(config: Record<string,unknown>,context: ConditionContext): boolean {
  if (!validCondition(config)) return false;
  const actual = lookup(context[String(config.source)],String(config.field)); const expected = config.value;
  switch(config.operator) {
    case 'exists': return actual!==undefined;
    case 'not_exists': return actual===undefined;
    case 'equals': return actual===expected;
    case 'not_equals': return actual!==expected;
    case 'greater_than': return typeof actual==='number' && typeof expected==='number' && actual>expected;
    case 'greater_or_equal': return typeof actual==='number' && typeof expected==='number' && actual>=expected;
    case 'less_than': return typeof actual==='number' && typeof expected==='number' && actual<expected;
    case 'less_or_equal': return typeof actual==='number' && typeof expected==='number' && actual<=expected;
    case 'contains': return Array.isArray(actual) ? actual.some((value) => value===expected) : typeof actual==='string' && typeof expected==='string' && actual.includes(expected);
    case 'not_contains': return Array.isArray(actual) ? !actual.some((value) => value===expected) : typeof actual==='string' && typeof expected==='string' && !actual.includes(expected);
    default: return false;
  }
}
export function scoreClassification(score: number): 'cold' | 'warm' | 'hot' | 'sales_ready' { return score>=50 ? 'sales_ready' : score>=25 ? 'hot' : score>=10 ? 'warm' : 'cold'; }
