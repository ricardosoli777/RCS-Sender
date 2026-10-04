'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui';
import { campaignError,type Campaign } from './model';
export default function CancelCampaign({ workspaceId,campaign }: { workspaceId: string; campaign: Campaign }) {
  const router = useRouter(); const [pending,setPending] = useState(false); const [cancelled,setCancelled] = useState(false); const [error,setError] = useState('');
  async function cancel() {
    if (pending || cancelled || !window.confirm('Cancelar este rascunho? Ele não poderá mais ser editado.')) return;
    setPending(true); setError('');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/campaigns/${campaign.id}/cancel`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify({ expectedRevision: campaign.revision }) });
      if (!response.ok) { setError(campaignError(response.status)); return; } setCancelled(true); router.refresh();
    } catch { setError('Não foi possível confirmar o cancelamento. Recarregue a campanha.'); } finally { setPending(false); }
  }
  return <div><Button type="button" variant="danger" disabled={pending || cancelled} onClick={() => void cancel()}>Cancelar campanha</Button><p className="formError" role="alert">{error}</p></div>;
}
