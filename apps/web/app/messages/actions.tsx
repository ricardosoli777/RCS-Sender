'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui';
import { messageHref,mutationError,type MessageDetail,type MessageStatus } from './types';
export default function MessageActions({ detail,workspaceId,canManage }: { detail: MessageDetail; workspaceId: string; canManage: boolean }) {
  const router = useRouter(); const [pending,setPending] = useState(false); const [error,setError] = useState(''); const [success,setSuccess] = useState('');
  if (!canManage) return null;
  const { message,current } = detail;
  async function mutate(status?: MessageStatus) {
    if (pending) return; setPending(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/messages${status ? `/${message.id}/status` : ''}`,{
        method: status ? 'PATCH' : 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },
        body: JSON.stringify(status ? { status,expectedVersion: message.current_version } : {
          name: `${Array.from(current.name).slice(0,90).join('')} (cópia)`,purpose: current.purpose,...(current.archetype?{archetype:current.archetype}:{}),content: current.content
        })
      });
      if (!response.ok) { setError(mutationError(response.status)); return; }
      const saved: MessageDetail = await response.json();
      if (!status) router.push(messageHref(saved.message.id,workspaceId));
      else setSuccess('Estado atualizado.');
      router.refresh();
    } catch { setError('Não foi possível conectar. Recarregue para conferir o estado da mensagem.'); }
    finally { setPending(false); }
  }
  return <div><div className="memberActions messageActions">
    {message.status !== 'archived' && message.active_version !== message.current_version && <Button disabled={pending} onClick={() => void mutate('active')}>Ativar versão {message.current_version}</Button>}
    {message.status !== 'draft' && <Button variant="secondary" disabled={pending} onClick={() => void mutate('draft')}>{message.status === 'archived' ? 'Restaurar rascunho' : 'Voltar a rascunho'}</Button>}
    {message.status !== 'archived' && <Button variant="secondary" disabled={pending} onClick={() => void mutate('archived')}>Arquivar</Button>}
    <Button variant="secondary" disabled={pending} onClick={() => void mutate()}>Duplicar como rascunho</Button>
  </div><p role="alert" className="formError">{error}</p><p role="status" className="formSuccess">{success}</p></div>;
}
