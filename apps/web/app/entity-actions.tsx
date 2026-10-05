'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil,Trash2 } from 'lucide-react';
import { Button } from './ui';

export function EditEntity({ href,label = 'Editar' }: { href: string; label?: string }) {
  return <Link className="button buttonSecondary" href={href}><Pencil size={16} aria-hidden="true"/>{label}</Link>;
}
export default function EntityActions({ workspace,kind,id,name,revision,editHref,canDelete,canEdit = true }: { workspace: string; kind: 'messages' | 'campaigns' | 'journeys'; id: string; name: string; revision: number; editHref?: string; canDelete: boolean; canEdit?: boolean }) {
  const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function remove() {
    if (busy || !window.confirm(`Excluir “${name}” da lista? O histórico de versões e execuções será preservado. Esta ação não pode ser desfeita pelo painel.`)) return;
    setBusy(true);setError('');
    try {
      const response=await fetch(`/api/workspaces/${workspace}/${kind}/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json','X-RCS-Request':'1'},body:JSON.stringify({expectedRevision:revision}),signal:AbortSignal.timeout(15000)});
      if(!response.ok){const result=await response.json();setError(response.status===409?result.message:'Não foi possível excluir. Recarregue para conferir o item.');return;}
      router.push(`/${kind}?workspace=${encodeURIComponent(workspace)}`);router.refresh();
    }catch{setError('A exclusão não foi confirmada. Recarregue para conferir a lista.');}finally{setBusy(false);}
  }
  return <div><div className="entityActions">{canEdit && editHref && <EditEntity href={editHref}/>}<Button type="button" variant="danger" disabled={busy || !canDelete} title={!canDelete?'Você não tem permissão para excluir este item.':undefined} onClick={()=>void remove()}><Trash2 size={16} aria-hidden="true"/>{busy?'Excluindo…':'Excluir'}</Button></div>{error && <p className="formError" role="alert">{error}</p>}</div>;
}
