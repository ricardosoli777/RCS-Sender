import AppShell from '../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../workspace';
import Connections,{type Provider,type Connection} from './connections';
export default async function IntegrationsPage({searchParams}:{searchParams:Promise<{workspace?:string}>}){
  const data=await workspaceData((await searchParams).workspace);if(!data)return <WorkspaceUnavailable/>;let providers:Provider[]|null=null;
  if(data.context.permissions.includes('providers.manage'))try{const response=await apiGet(`/workspaces/${data.selected.id}/providers/catalog`,data.apiHeaders);if(response.ok)providers=(await response.json()).providers;}catch{ /* Preserve unavailable catalog. */ }
  let connections:Connection[]|null=null;
  if(providers)try{const response=await apiGet(`/workspaces/${data.selected.id}/providers`,data.apiHeaders);if(response.ok)connections=(await response.json()).connections;}catch{ /* Preserve a failed read. */ }
  return <AppShell data={data} active="/integrations"><div className="pageHeading"><div><p className="eyebrow">PROVEDORES RCS</p><h1>Integrações</h1><p>Escolha Google, Infobip, Twilio, Sinch ou Zenvia e cadastre as credenciais da sua conta. Você pode manter várias conexões e escolher uma em cada campanha ou etapa da jornada.</p><p>Salvar não envia mensagens nem testa automaticamente. O botão Testar conexão consulta o fornecedor; acesso à conta e agente pronto para enviar são verificações distintas.</p></div></div>{providers?<Connections key={data.selected.id} workspace={data.selected.id} providers={providers} initial={connections} origin={process.env.APP_URL??''}/>:<p role="alert">Catálogo indisponível ou sem permissão.</p>}</AppShell>;
}
