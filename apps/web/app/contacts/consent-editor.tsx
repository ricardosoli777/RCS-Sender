'use client';
import { useId,useState,type FormEvent } from 'react';
import { Button,Card } from '../ui';
import { consentError,consentRecord,consentStateLabels,purposeLabels,sourceLabels,type ConsentFields,type ConsentSnapshot } from './consent-model';
export default function ConsentEditor({ initialSnapshot,canManage,workspaceId }: { initialSnapshot: ConsentSnapshot; canManage: boolean; workspaceId: string }) {
  const fieldId = useId();
  const [snapshot,setSnapshot] = useState(initialSnapshot); const [pending,setPending] = useState(false); const [error,setError] = useState(''); const [invalid,setInvalid] = useState(''); const [success,setSuccess] = useState('');
  const [fields,setFields] = useState<ConsentFields>({ purpose: 'marketing',state: 'granted',source: 'manual_record',evidenceReference: '',observedUtc: '' });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || error || !canManage) return;
    setInvalid(''); setSuccess(''); let body: ReturnType<typeof consentRecord>;
    try { body = consentRecord(snapshot,fields); } catch (error) { setInvalid(error instanceof Error ? error.message : 'Confira os dados.'); return; }
    if (!window.confirm(`Registrar ${fields.state === 'granted' ? 'declaração de consentimento' : 'revogação de consentimento'} para ${snapshot.phone}, finalidade ${purposeLabels[fields.purpose]}, observada em ${body.observedAt}? O histórico será preservado e opt-out não será removido.`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/contacts/${snapshot.contactId}/rcs-consents`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-RCS-Request': '1' },body: JSON.stringify(body),signal: AbortSignal.timeout(10000) });
      if (!response.ok) { setError(consentError(response.status)); return; }
      setSnapshot(await response.json()); setFields((previous) => ({ ...previous,evidenceReference: '',observedUtc: '' })); setSuccess('Registro salvo. O histórico anterior foi preservado.');
    } catch { setError('Conexão interrompida. Recarregue os registros para conferir se a gravação foi concluída antes de tentar novamente.'); } finally { setPending(false); }
  }
  const current = snapshot.consents.find((item) => item.purpose === fields.purpose);
  return <><Card><h2>Consentimento RCS por finalidade</h2><p>Telefone do registro: <strong>{snapshot.phone}</strong></p>
    {snapshot.optedOut && <p role="status">Opt-out registrado. Este contato permanece bloqueado, mesmo com uma declaração de consentimento.</p>}
    <div className="tableScroll"><table><caption>Último registro de cada finalidade para este telefone</caption><thead><tr><th scope="col">Finalidade</th><th scope="col">Estado</th><th scope="col">Origem declarada</th><th scope="col">Observação (UTC)</th></tr></thead><tbody>{snapshot.consents.map((item) => <tr key={item.purpose}><td>{purposeLabels[item.purpose]}</td><td data-label="Estado">{consentStateLabels[item.state]}<small>Revisão {item.revision}</small></td><td data-label="Origem declarada">{item.source ? sourceLabels[item.source] : 'Sem origem registrada'}</td><td data-label="Observação (UTC)">{item.observedAt ? item.observedAt.replace('T',' ').replace('Z',' UTC') : 'Sem observação registrada'}</td></tr>)}</tbody></table></div>
    <p>Cadastro, elegibilidade e confirmação de campanha não criam consentimento. A origem e a evidência são informadas pelo responsável; o sistema preserva o registro sem verificar a fonte externa.</p>
  </Card>{canManage && <Card><h2>Registrar declaração ou revogação</h2><p>Informe a referência da evidência e quando a declaração ou revogação foi observada. A gravação cria uma nova revisão para o telefone e a finalidade escolhidos.</p>
    <p className="formError" role="alert">{error || invalid}</p><p className="formSuccess" role="status">{success}</p>{pending && <p role="status">Salvando registro…</p>}
    <form className="contactForm" onSubmit={(event) => void submit(event)}><fieldset className="messageFields" disabled={pending || !!error}><legend>Dados do registro</legend>
      <label>Finalidade<select aria-label="Finalidade" value={fields.purpose} onChange={(event) => { setFields({ ...fields,purpose: event.target.value as ConsentFields['purpose'] }); setInvalid(''); setSuccess(''); }}>{Object.entries(purposeLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <p>Revisão atual desta finalidade: {current?.revision ?? 'indisponível'} · {current ? consentStateLabels[current.state] : 'Recarregue os registros'}</p>
      <label>Estado a registrar<select aria-label="Estado a registrar" value={fields.state} onChange={(event) => setFields({ ...fields,state: event.target.value as ConsentFields['state'] })}><option value="granted">Declaração de consentimento</option><option value="revoked">Revogação de consentimento</option></select></label>
      <label>Origem declarada<select aria-label="Origem declarada" value={fields.source} onChange={(event) => setFields({ ...fields,source: event.target.value as ConsentFields['source'] })}>{Object.entries(sourceLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="campaignPicker"><label htmlFor={`${fieldId}-evidence`}>Referência da evidência</label><input id={`${fieldId}-evidence`} aria-describedby={`${fieldId}-evidence-help`} required maxLength={128} value={fields.evidenceReference} autoComplete="off" onChange={(event) => setFields({ ...fields,evidenceReference: event.target.value })} /><small id={`${fieldId}-evidence-help`}>Identificador de até 128 caracteres, sem espaços. Use letras, números, ponto, sublinhado, dois-pontos, barra ou hífen. Não cole o conteúdo da evidência ou segredos.</small></div>
      <div className="campaignPicker"><label htmlFor={`${fieldId}-date`}>Data e horário da observação (UTC)</label><input id={`${fieldId}-date`} aria-describedby={`${fieldId}-date-help`} type="datetime-local" required step={1} value={fields.observedUtc} onChange={(event) => setFields({ ...fields,observedUtc: event.target.value })} /><small id={`${fieldId}-date-help`}>Informe o horário em UTC em que a declaração ou revogação ocorreu; não use uma data futura.</small></div>
      <Button type="submit" disabled={!current}>Registrar declaração ou revogação</Button>
    </fieldset></form>{error && <Button variant="secondary" onClick={() => window.location.reload()}>Recarregar registros</Button>}
  </Card>}</>;
}
