'use client';
import { useId,useState,type FormEvent } from 'react';
import { Button,Card } from '../ui';
import ProviderGuide from './provider-guide';

export type Provider = { metadata: { id: string; name: string; environments: string[]; credentialSchema: { key: string; label: string; required: boolean; secret: boolean }[] }; active: boolean; capabilities: Record<string,string> };
export type Connection = { id: string; provider_id: string; name: string; environment: string; status: 'unverified' | 'connected' | 'disconnected' | 'disabled'; external_agent_id: string | null };
const statuses = { unverified: 'Credenciais salvas · não verificada',connected: 'Conexão verificada',disconnected: 'Conexão não confirmada',disabled: 'Conexão desativada' };
function failure(status: number) {
  return status===403 ? 'Você não tem permissão para alterar as integrações.' : status===400 ? 'Confira os campos e o formato das credenciais.' : status===409 ? 'Não foi possível salvar. Confira os campos, o vínculo do agente e a lista de conexões antes de tentar novamente.' : 'Não foi possível confirmar a operação. Recarregue para conferir o estado salvo.';
}
function ConnectionForm({ provider,connection,busy,origin,onSave }: { provider: Provider; connection?: Connection; busy: boolean; origin: string; onSave(name: string,environment: string,credentials: Record<string,string>): Promise<boolean> }) {
  const id=useId(); const [name,setName]=useState(''); const [environment,setEnvironment]=useState(provider.metadata.environments[0]??''); const [credentials,setCredentials]=useState<Record<string,string>>(():Record<string,string>=>provider.metadata.id==='twilio' && origin.startsWith('https://')?{webhookUrl:`${origin}/webhooks/rcs/twilio?connectionId=${connection?.id??'00000000-0000-4000-8000-000000000000'}`}:{ });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy)return;
    if(await onSave(name,environment,credentials)){setCredentials({});setName('');}
  }
  return <><ProviderGuide provider={provider}/><form className="contactForm" onSubmit={event=>void submit(event)}><fieldset className="messageFields" disabled={busy || !provider.active}><legend>{connection ? `Substituir credenciais de ${connection.name}` : `Adicionar conexão ${provider.metadata.name}`}</legend>
    {!connection && <><label htmlFor={`${id}-name`}>Nome da conexão<input id={`${id}-name`} required maxLength={100} value={name} onChange={event=>setName(event.target.value)} placeholder="Minha conta RCS"/></label><label htmlFor={`${id}-environment`}>Ambiente<select id={`${id}-environment`} value={environment} onChange={event=>setEnvironment(event.target.value)}>{provider.metadata.environments.map(value=><option key={value} value={value}>{value==='test'?'Teste':value==='production'?'Produção':value}</option>)}</select></label></>}
    {provider.metadata.credentialSchema.map(field=><label key={field.key} htmlFor={`${id}-${field.key}`}>{field.label}{field.key==='privateKey' ? <textarea id={`${id}-${field.key}`} required={field.required} rows={5} maxLength={16384} autoComplete="off" spellCheck={false} value={credentials[field.key]??''} onChange={event=>setCredentials({...credentials,[field.key]:event.target.value})}/> : <input id={`${id}-${field.key}`} type={field.secret?'password':'text'} required={field.required} maxLength={16384} autoComplete="off" spellCheck={false} value={credentials[field.key]??''} onChange={event=>setCredentials({...credentials,[field.key]:event.target.value})}/>}</label>)}
    <Button type="submit">{busy?'Salvando…':connection?'Salvar novas credenciais':'Salvar conexão'}</Button>
  </fieldset></form></>;
}
export default function Connections({ workspace,providers,initial,origin }: { workspace: string; providers: Provider[]; initial: Connection[] | null; origin: string }) {
  const [connections,setConnections]=useState(initial??[]); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [success,setSuccess]=useState('');
  const base=`/api/workspaces/${workspace}/providers`;
  async function save(provider: Provider,connection: Connection | undefined,name: string,environment: string,credentials: Record<string,string>) {
    if(busy)return false;setBusy(true);setError('');setSuccess('');
    try {
      const response=await fetch(connection?`${base}/${connection.id}/credentials`:base,{method:connection?'PUT':'POST',headers:{'Content-Type':'application/json','X-RCS-Request':'1'},body:JSON.stringify(connection?{credentials}:{providerId:provider.metadata.id,name,environment,credentials}),signal:AbortSignal.timeout(15000)});
      if(!response.ok){setError(failure(response.status));return false;}
      if(connection)setConnections(previous=>previous.map(item=>item.id===connection.id?{...item,status:'unverified'}:item));
      else {const result=await response.json();setConnections(previous=>[result.connection,...previous]);}
      setSuccess('Credenciais salvas e campos limpos. Use Testar conexão quando quiser consultar o fornecedor.');return true;
    }catch{setError('Conexão interrompida. Recarregue a lista antes de tentar salvar novamente.');return false;}finally{setBusy(false);}
  }
  async function test(connection: Connection) {
    if(busy)return;setBusy(true);setError('');setSuccess('');
    try {
      const response=await fetch(`${base}/${connection.id}/test`,{method:'POST',headers:{'Content-Type':'application/json','X-RCS-Request':'1'},body:'{}',signal:AbortSignal.timeout(15000)});
      if(!response.ok){setError(failure(response.status));return;}
      const result=await response.json();const status=result.status==='connected'?'connected':'disconnected';setConnections(previous=>previous.map(item=>item.id===connection.id?{...item,status}:item));
      if(status==='connected')setSuccess(`Conexão ${connection.name} verificada. Nenhuma mensagem foi enviada.`);
      else setError(result.error?.code==='invalid_credentials'?'O fornecedor recusou as credenciais. Confira os dados e as permissões da conta.':'O adaptador não confirmou o acesso à conta. A conexão permanece indisponível para envio.');
    }catch{setError('Não foi possível concluir o teste. Recarregue para conferir o resultado.');}finally{setBusy(false);}
  }
  return <div className="settingsGrid"><div aria-live="polite"><p className="formError" role="alert">{error}</p><p className="formSuccess" role="status">{success}</p>{initial===null && <p role="alert">Não foi possível carregar as conexões existentes. Recarregue antes de cadastrar outra.</p>}</div>{providers.map(provider=><Card key={provider.metadata.id}><h2>{provider.metadata.name}</h2><p>{provider.active?'Disponível para configurar':'Indisponível para configurar'}</p>{connections.filter(connection=>connection.provider_id===provider.metadata.id).map(connection=><section className="integrationConnection" key={connection.id}><h3>{connection.name}</h3><p>{statuses[connection.status]} · {connection.environment==='test'?'Teste':connection.environment}</p><p>Agente: {connection.external_agent_id??'Não informado pelo adaptador'}</p><label>URL de callback<input readOnly value={`${origin}/webhooks/rcs/${provider.metadata.id}?connectionId=${connection.id}`}/></label><div className="memberActions messageActions"><Button type="button" disabled={busy || !provider.active || connection.status==='disabled'} onClick={()=>void test(connection)}>Testar conexão {connection.name}</Button></div><details><summary>Substituir credenciais</summary><p>Informe todos os campos novamente. O agente deve continuar sendo o da conexão original.</p><ConnectionForm provider={provider} connection={connection} busy={busy} origin={origin} onSave={(name,environment,credentials)=>save(provider,connection,name,environment,credentials)}/></details></section>)}{initial!==null && <details open={!connections.some(connection=>connection.provider_id===provider.metadata.id)}><summary>Adicionar conexão</summary><ConnectionForm provider={provider} busy={busy} origin={origin} onSave={(name,environment,credentials)=>save(provider,undefined,name,environment,credentials)}/></details>}</Card>)}</div>;
}
