'use client';
import { useEffect,useState } from 'react';
import { Button } from '../ui';
import type { CampaignOption,OptionKind } from './model';
export default function OptionPicker({ workspaceId,kind,label,value,disabled,onChange }: { workspaceId: string; kind: OptionKind; label: string; value: string | null; disabled: boolean; onChange: (id: string | null,option?: CampaignOption) => void }) {
  const [offset,setOffset] = useState(0); const [page,setPage] = useState<{ options: CampaignOption[]; total: number } | null>(null); const [loading,setLoading] = useState(true); const [error,setError] = useState(false); const [retry,setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/workspaces/${workspaceId}/campaigns/options?kind=${kind}&offset=${offset}`,{ signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); const data = await response.json(); if (!controller.signal.aborted) { setPage(data); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[workspaceId,kind,offset,retry]);
  function navigate(next: number) { setLoading(true); setPage(null); setError(false); setOffset(next); }
  return <div className="campaignPicker"><label>{label}<select aria-label={label} value={value ?? ''} disabled={disabled || loading || error} onChange={(event) => { const id = event.target.value || null; onChange(id,page?.options.find((item) => item.id === id)); }}>
    <option value="">Sem seleção</option>{value && !page?.options.some((item) => item.id === value) && <option value={value}>Seleção vinculada fora desta página</option>}
    {page?.options.map((item) => <option key={item.id} value={item.id}>{item.name}{item.version ? ` · versão ${item.version}` : item.contactCount !== undefined ? ` · ${item.contactCount} contatos` : item.status ? ` · ${item.status === 'connected' ? 'conectada' : item.status === 'disabled' ? 'desativada' : 'não verificada'}` : ''}</option>)}
  </select></label>
  {loading && <small role="status">Carregando opções…</small>}{error && <><small role="alert">Opções indisponíveis. A seleção vinculada foi preservada.</small><Button type="button" variant="secondary" disabled={disabled} onClick={() => { setLoading(true); setRetry((number) => number+1); }}>Tentar carregar {label.toLowerCase()}</Button></>}
  {page && !loading && !error && <><small>{page.total} opções · até 50 por página</small><div className="memberActions messageActions">{offset > 0 && <Button type="button" variant="secondary" disabled={disabled} onClick={() => navigate(Math.max(0,offset-50))}>Opções anteriores de {label.toLowerCase()}</Button>}{offset+50 < page.total && <Button type="button" variant="secondary" disabled={disabled} onClick={() => navigate(offset+50)}>Mais opções de {label.toLowerCase()}</Button>}</div></>}
  {value && <Button type="button" variant="secondary" disabled={disabled || loading} onClick={() => onChange(null)}>Remover seleção de {label.toLowerCase()}</Button>}
  </div>;
}
