'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { journeyHref } from './model';
export default function CreateJourney({ workspace }: { workspace: string }) {
  const [name,setName] = useState(''); const [busy,setBusy] = useState(false); const [blocked,setBlocked] = useState(false); const [error,setError] = useState(''); const router = useRouter();
  return <form onSubmit={async (event) => { event.preventDefault(); if (busy || blocked) return; setBusy(true); setError(''); try { const response = await fetch(`/api/workspaces/${workspace}/journeys`,{ method: 'POST',headers: { 'content-type': 'application/json','x-rcs-request': '1' },body: JSON.stringify({ name }),signal: AbortSignal.timeout(10000) }); if (!response.ok) { setBlocked(true); throw new Error('Não foi possível criar. Recarregue antes de tentar novamente.'); } const result = await response.json(); router.push(journeyHref(result.journey.id,workspace)); } catch { setBlocked(true); setError('Não foi possível confirmar a criação. Recarregue para conferir a lista.'); } finally { setBusy(false); } }}><h2>Nova jornada</h2><label>Nome da jornada<input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} /></label><button disabled={busy || blocked}>{busy ? 'Criando…' : 'Criar jornada'}</button>{error && <p role="alert">{error}</p>}</form>;
}
