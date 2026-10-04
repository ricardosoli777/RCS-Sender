// Test-only IPC harness. No vendor HTTP client or production credentials are used.
import {Pool} from 'pg';
import {CredentialCipher} from '@rcs/security';
import {MockRcsProvider,ProviderRegistry,activationChecks} from '@rcs/providers';
import {CampaignDispatch} from '@rcs/dispatch';
process.once('message',async input=>{
  let pool;
  try{
    if(process.env.RUN_NATIVE_DOMAIN_TESTS!=='1' || !/^domain_test_[a-f0-9]{32}$/.test(input.schema))throw new Error();
    pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${input.schema}`});
    const adapter=new MockRcsProvider();const metadata=adapter.getProviderMetadata();const capabilities=adapter.getProviderCapabilities();adapter.getProviderMetadata=()=>({...metadata,id:'fixture'});adapter.getProviderCapabilities=()=>({...capabilities,eligibility:'supported'});adapter.getExternalAgentId=()=> 'agent-a';adapter.getAgent=async()=>({id:'agent-a',name:'Local',status:'active'});adapter.getAgentCapabilities=async()=>adapter.getProviderCapabilities();
    adapter.send=async()=>{process.send({type:'send'});return {accepted:true,providerMessageId:'native-proof'};};
    adapter.checkEligibility=async()=>true;
    const registry=new ProviderRegistry();registry.register(adapter,{documentPath:'docs/providers/mock.md',reviewedAt:'2026-10-04',references:['https://example.test/local-fixture'],checks:Object.fromEntries(activationChecks.map(key=>[key,true]))});
    const cipher=new CredentialCipher('test',{test:Buffer.from(input.key,'base64')});const service=new CampaignDispatch(pool,registry,cipher,()=>input.clock);
    const result=await service.dispatch(input.context,input.campaignId,input.contactId,input.revision,new AbortController().signal);process.send({type:'result',status:result.status});
  }catch{process.send({type:'error'});}finally{await pool?.end();process.disconnect();}
});
