import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
if(process.env.RUN_SERVICE_TESTS!=='1' || !process.env.DATABASE_URL)throw new Error('Requires RUN_SERVICE_TESTS=1 and an isolated DATABASE_URL.');
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const args=[join(dirname(require.resolve('vitest/package.json')),'vitest.mjs'),'run','src/modules/campaigns/store.test.ts','-t','correlates an early|native independent processes|rotates encrypted|asynchronous eligibility|reconciles ambiguous|bounded retention|pinned private asset|shares request slots'];
const result=spawnSync(process.execPath,args,{cwd:fileURLToPath(new URL('../apps/api',import.meta.url)),env:{...process.env,RUN_NATIVE_DOMAIN_TESTS:'1'},stdio:'inherit'});
process.exitCode=result.status??1;
