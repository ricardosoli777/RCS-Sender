import {randomUUID} from 'node:crypto';
import {test as base,expect} from '@playwright/test';
// Each browser scenario gets its own trusted edge identity and Redis quota.
export const test=base.extend({extraHTTPHeaders:async({},use)=>{
  const suffix=randomUUID().replaceAll('-','').slice(0,12).match(/.{4}/g)!.join(':');
  await use({'x-rcs-edge-token':'a'.repeat(64),'x-rcs-client-ip':`2001:db8:${suffix}::1`});
}});
export {expect};
