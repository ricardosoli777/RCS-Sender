import {createServer,request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const servers=[3000,3001].map(port=>createServer((request,response)=>{
  response.setHeader('content-type','application/json');response.end(JSON.stringify({port,headers:request.headers}));
}));
await Promise.all(servers.map((server,i)=>new Promise(resolve=>server.listen(3000+i,'127.0.0.1',resolve))));
const child=spawn('caddy',['run','--config','ops/Caddyfile.swarm','--adapter','caddyfile'],{
  env:{...process.env,RCS_DOMAIN:'edge.test',RCS_TRUSTED_PROXY_CIDR:'127.0.0.1/32',RCS_CLOUDFLARE_CIDRS:'173.245.48.0/20',
    RCS_API_PROXY_SECRET:'fixture-api-token',RCS_EDGE_PROXY_SECRET:'fixture-edge-token'},stdio:'ignore'});
const stopped=new Promise(resolve=>child.once('exit',resolve));
function probe(path,headers){return new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:8080,path,headers},response=>{
    let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});
    response.on('end',()=>resolve({status:response.statusCode,json:()=>JSON.parse(body)}));
  });req.on('error',reject);req.setTimeout(2000,()=>req.destroy(new Error('Timeout')));req.end();
});}
try{
  let ready=false;
  for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:8080',{headers:{host:'edge.test'}});ready=true;break;}catch{await delay(100);}}
  assert(ready,'edge starts with the versioned Caddy configuration');
  async function request(path,extra){const response=await probe(path,{host:'edge.test',...extra});assert.equal(response.status,200);return response.json();}
  const direct=await request('/login',{'x-forwarded-for':'203.0.113.9','cf-connecting-ip':'198.51.100.99','x-rcs-client-ip':'198.51.100.88','x-rcs-edge-token':'forged','x-rcs-proxy-token':'forged'});
  assert.equal(direct.port,3000);assert.equal(direct.headers['x-rcs-client-ip'],'203.0.113.9');
  assert.equal(direct.headers['x-rcs-edge-token'],'fixture-edge-token');assert.equal(direct.headers['x-rcs-proxy-token'],undefined);
  const cloud=await request('/login',{'x-forwarded-for':'198.51.100.6, 173.245.48.20','cf-connecting-ip':'198.51.100.6'});
  assert.equal(cloud.headers['x-rcs-client-ip'],'198.51.100.6');
  const callback=await request('/webhooks/rcs/example',{'x-forwarded-for':'203.0.113.9','x-rcs-edge-token':'forged'});
  assert.equal(callback.port,3001);assert.equal(callback.headers['x-rcs-proxy-token'],'fixture-api-token');assert.equal(callback.headers['x-rcs-edge-token'],undefined);
  assert.equal((await probe('/',{host:'foreign.test'})).status,421);
  console.log('Swarm edge contract passed: direct/Cloudflare IP, spoofing, callback isolation, Host binding.');
}finally{
  child.kill('SIGTERM');await stopped;await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
}
