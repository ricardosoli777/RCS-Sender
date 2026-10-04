import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root=resolve(import.meta.dirname,'..'); const failures=[]; let checked=0;
async function walk(directory) { const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(['node_modules','.git','.next','dist','.pnpm-store','.planning','test-results','playwright-report'].includes(entry.name))continue;const path=resolve(directory,entry.name);if(entry.isDirectory())result.push(...await walk(path));else result.push(path);}return result; }
const files=await walk(root);
for(const path of files){if(!/\.(?:md|[cm]?[jt]sx?|ya?ml|json|sql|sh)$/.test(path))continue;const source=await readFile(path,'utf8');checked++;
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{60,}?-----END/.test(source) || /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(source))failures.push(`${path}: potential secret (value omitted)`);
  if(path.endsWith('.md'))for(const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){const target=match[1].split('#')[0];if(!target || /^(?:https?:|mailto:|app:|<)/.test(target))continue;try{await stat(resolve(dirname(path),decodeURIComponent(target)));}catch{failures.push(`${path}: missing local link ${target}`);}}
}
for(const file of ['ops/Dockerfile','ops/compose.yaml','ops/Caddyfile','ops/backup.sh','ops/restore-drill.sh','docs/operations.md','docs/journeys.md','docs/production-readiness.md'])try{await stat(resolve(root,file));}catch{failures.push(`Missing ${file}`);}
if(failures.length){for(const failure of failures)console.error(failure);process.exitCode=1;}else console.log(`Local release check passed (${checked} files). No VPS, Docker, provider or remote-link proof performed.`);
