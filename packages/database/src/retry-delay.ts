import {createHash} from 'node:crypto';
/** Equal jitter, stable across process restarts and distinct for each durable job. */
export function retryDelay(key: string,attempt: number,base=5000): number {
  const bounded=Math.min(16,Math.max(1,attempt));
  const ceiling=Math.min(3600000,base*2**(bounded-1));
  const fraction=createHash('sha256').update(`${key}:${bounded}`).digest().readUInt32BE(0)/0x100000000;
  return Math.floor(ceiling*(0.5+fraction*0.5));
}
