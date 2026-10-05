'use client';
import { useState,type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Button,Card } from '../ui';
import OptionPicker from './option-picker';
import { campaignError,campaignForm,campaignHref,formIssues,utcInput,type Campaign,type CampaignForm } from './model';
export default function CampaignEditor({ workspaceId,initial }: { workspaceId: string; initial?: Campaign }) {
  const router = useRouter(); const [form,setForm] = useState(() => campaignForm(initial)); const [pending,setPending] = useState(false); const [saved,setSaved] = useState(false); const [error,setError] = useState(''); const issues = formIssues(form);
  function change(patch: Partial<CampaignForm>) { setForm((current) => ({ ...current,...patch })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || saved || issues.length) return; setPending(true); setError('');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/campaigns${initial ? `/${initial.id}` : ''}`,{ method: initial ? 'PUT' : 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify({ ...form,...(initial ? { expectedRevision: initial.revision } : {}) }) });
      if (!response.ok) { setError(campaignError(response.status)); return; }
      const result = await response.json(); setSaved(true); router.push(campaignHref(result.campaign.id,workspaceId)); router.refresh();
    } catch { setError('Conexão interrompida. Recarregue para conferir se o rascunho foi salvo.'); } finally { setPending(false); }
  }
  return <Card id="entity-editor"><h2>{initial ? `Editar rascunho · revisão ${initial.revision}` : 'Nova campanha'}</h2><p>Salve a configuração e confira as pendências na revisão local.</p><form className="contactForm" onSubmit={submit}><fieldset className="messageFields" disabled={pending || saved}>
    <legend>Configuração do rascunho</legend><label>Nome da campanha<input required value={form.name} onChange={(event) => change({ name: event.target.value })} /></label><label>Objetivo<input required value={form.objective} onChange={(event) => change({ objective: event.target.value })} /></label>
    <OptionPicker workspaceId={workspaceId} kind="connections" label="Conexão" value={form.providerConnectionId} disabled={pending || saved} onChange={(id,option) => change({ providerConnectionId: id,agentId: option?.agentId ?? null })} />
    <label>Identificador do agente<input value={form.agentId ?? ''} onChange={(event) => change({ agentId: event.target.value || null })} /></label><p>O agente vinculado à conexão é preenchido quando disponível. A revisão local aponta divergências; não consulta agentes reais.</p>
    <OptionPicker workspaceId={workspaceId} kind="audiences" label="Lista de audiência" value={form.audienceListId} disabled={pending || saved} onChange={(id) => change({ audienceListId: id })} />
    <OptionPicker workspaceId={workspaceId} kind="messages" label="Versão da mensagem" value={form.messageVersionId} disabled={pending || saved} onChange={(id) => change({ messageVersionId: id })} />
    <p>O seletor oferece versões ativas. A versão já vinculada permanece selecionada mesmo que uma versão nova seja ativada na biblioteca.</p>
    <label>Data e horário (UTC)<input type="datetime-local" step={60} value={form.scheduledAt?.slice(0,16) ?? ''} onChange={(event) => change({ scheduledAt: utcInput(event.target.value) })} /></label><p>UTC é o horário de referência, sem conversão automática. Configurar a data não agenda um envio nesta etapa.</p>
  </fieldset><div aria-live="polite">{issues.length > 0 && <ul className="formError">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div><Button type="submit" disabled={pending || saved || issues.length > 0}><Save size={16} aria-hidden="true"/>{pending ? 'Salvando…' : saved ? 'Rascunho salvo' : initial ? 'Salvar rascunho' : 'Criar campanha'}</Button><p className="formError" role="alert">{error}</p></form></Card>;
}
