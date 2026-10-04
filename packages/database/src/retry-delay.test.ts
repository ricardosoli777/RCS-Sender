import {describe,expect,it} from 'vitest';
import {retryDelay} from './retry-delay.js';
describe('durable retry jitter',()=>{
  it('spreads a simultaneous batch within exponential bounds and preserves schedules across restarts',()=>{
    const values=Array.from({length:100},(_,i)=>retryDelay(`workspace:job-${i}`,3));
    expect(new Set(values).size).toBeGreaterThan(90);
    for(const value of values){expect(value).toBeGreaterThanOrEqual(10000);expect(value).toBeLessThan(20000);}
    expect(retryDelay('workspace:job-0',3)).toBe(values[0]);
    expect(retryDelay('workspace:job-0',1000)).toBeLessThanOrEqual(3600000);
  });
});
