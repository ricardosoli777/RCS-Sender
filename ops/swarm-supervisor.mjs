import {spawn} from 'node:child_process';
const children=[];
let stopping=false;
function stop(code){
  if(stopping)return;
  stopping=true;process.exitCode=code;
  for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
  const deadline=setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');},25000);
  deadline.unref();
}
const programs=[
  ['api',process.execPath,['apps/api/dist/main.js']],
  ['web',process.execPath,['apps/web/node_modules/next/dist/bin/next','start','apps/web','-H','127.0.0.1','-p','3000']],
  ['worker',process.execPath,['apps/worker/dist/main.js']],
  ['edge','caddy',['run','--config','ops/Caddyfile.swarm','--adapter','caddyfile']]
];
for(const [name,command,args] of programs){
  const child=spawn(command,args,{stdio:'inherit'});children.push(child);
  child.once('error',()=>{console.error(`RCS process failed to start: ${name}`);stop(1);});
  child.once('exit',(code,signal)=>{if(!stopping){console.error(`RCS process stopped: ${name} (${signal??code})`);stop(1);}});
}
process.once('SIGTERM',()=>stop(0));process.once('SIGINT',()=>stop(0));
