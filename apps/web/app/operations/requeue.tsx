'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function Requeue({ workspace,eventId,consumer }: { workspace:string;eventId:string;consumer:string }) {
  const router=useRouter(); const [busy,setBusy]=useState(false); const [blocked,setBlocked]=useState(false); const [error,setError]=useState('');
  const submit=async()=>{ if(busy || blocked || !confirm('Reprocessar este consumidor após corrigir a causa da falha?'))return; setBusy(true);try { const response=await fetch(`/api/workspaces/${workspace}/operations/requeue`,{method:'POST',headers:{'content-type':'application/json','x-rcs-request':'1'},body:JSON.stringify({eventId,consumer}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();router.refresh(); }catch{setBlocked(true);setError('Resultado não confirmado. Recarregue antes de tentar novamente.');}finally{setBusy(false);} };
  return <><button disabled={busy || blocked} onClick={()=>void submit()}>Reprocessar consumidor</button>{error && <p role="alert">{error}</p>}</>;
}
