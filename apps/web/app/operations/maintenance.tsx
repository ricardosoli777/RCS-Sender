'use client';
import {useState} from 'react';
import {Button} from '../ui';
export default function Maintenance({workspace}:{workspace:string}){
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [retainDays,setRetainDays]=useState(365);const [confirm,setConfirm]=useState(false);
  async function run(operation:'rotate-cipher'|'compact-history'){
    if(busy)return;setBusy(true);setMessage('');
    try{
      const response=await fetch(`/api/workspaces/${workspace}/operations/${operation}`,{method:'POST',headers:{'content-type':'application/json','x-rcs-request':'1'},body:JSON.stringify(operation==='rotate-cipher' ? {} : {retainDays})});
      if(!response.ok)throw new Error();const result=await response.json();
      setMessage(operation==='rotate-cipher' ? `Lote concluído. Restam ${result.remaining} registros para a chave ativa. Execute novamente enquanto houver registros.` : `${result.compacted} recebimentos antigos compactados neste lote.`);
      if(operation==='compact-history')setConfirm(false);
    }catch{setMessage('Manutenção indisponível. Confira as chaves configuradas e sua permissão antes de tentar novamente.');}finally{setBusy(false);}
  }
  return <section className="card"><h2>Manutenção do histórico</h2><p>A rotação usa a chave ativa configurada no servidor e preserva os dados e as versões publicadas. Mantenha as chaves anteriores até finalizar todos os lotes e verificar os backups.</p><Button type="button" disabled={busy} onClick={()=>void run('rotate-cipher')}>Rotacionar lote de cifras</Button><p>A compactação remove apenas o corpo bruto de webhooks antigos já concluídos ou descartados. Eventos normalizados, auditoria e identificadores de deduplicação permanecem preservados.</p><label>Conservar corpos brutos por quantos dias?<input type="number" min={30} max={3650} value={retainDays} onChange={event=>setRetainDays(Number(event.target.value))}/></label><label><input type="checkbox" checked={confirm} onChange={event=>setConfirm(event.target.checked)}/>Confirmo a remoção dos corpos brutos fora desse prazo.</label><Button type="button" disabled={busy || !confirm || !Number.isInteger(retainDays) || retainDays<30 || retainDays>3650} onClick={()=>void run('compact-history')}>Compactar lote antigo</Button><p role="status">{message}</p></section>;
}
