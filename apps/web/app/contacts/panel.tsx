'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '../ui';
import Link from 'next/link';
type Contact = { id: string; name: string; phone_normalized: string; opted_out: boolean };
export type ContactSnapshot = { contacts: Contact[]; lists: { id: string; name: string; contact_count: number }[]; total: number };
export default function ContactsPanel({ workspaceId, snapshot, canManage }: { workspaceId: string; snapshot: ContactSnapshot; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [text, setText] = useState('');
  async function mutate(path: string, method: string, body?: object) {
    setPending(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/${path}`, { method, headers: { 'X-RCS-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) { setError(response.status === 400 ? 'Confira o formato dos dados e os limites de importação.' : response.status === 409 ? 'A lista é usada por uma campanha e precisa ser preservada.' : response.status === 403 ? 'Você não tem permissão para esta operação.' : 'Não foi possível salvar. Recarregue e tente novamente.'); return false; }
      const result = response.status === 204 ? null : await response.json();
      setSuccess(result && 'created' in result ? `${result.created} novos; ${result.duplicates} duplicados; ${result.optedOut} bloqueados; ${result.invalidRows.length} inválidos.${result.invalidRows.length ? ` Linhas inválidas: ${result.invalidRows.join(', ')}.` : ''}` : 'Alteração salva.');
      router.refresh(); return true;
    } catch { setError('Não foi possível conectar. Tente novamente.'); return false; }
    finally { setPending(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>, kind: 'manual' | 'import' | 'list') {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    const listId = String(fields.get('listId') ?? '');
    const saved = kind === 'manual' ? await mutate('contacts', 'POST', { phone: fields.get('phone'), name: fields.get('name') })
      : kind === 'list' ? await mutate('contact-lists', 'POST', { name: fields.get('name') })
      : await mutate('contacts/import', 'POST', { text, ...(listId ? { listId } : {}) });
    if (saved) { form.reset(); if (kind === 'import') setText(''); }
  }
  async function loadFile(file?: File) {
    setError(''); if (!file) return;
    if (file.size > 65536) { setError('O arquivo deve ter até 64 KiB.'); return; }
    try { setText(await file.text()); } catch { setError('Não foi possível ler o arquivo.'); }
  }
  return <div className="settingsGrid"><div className="contactsFeedback"><p className="formError" role="alert">{error}</p><p className="formSuccess" role="status">{success}</p></div>
    {canManage && <><Card><h2>Novo contato</h2><form className="contactForm" onSubmit={(event) => submit(event, 'manual')}><label>Nome<input name="name" maxLength={100} disabled={pending} /></label><label>Telefone<input name="phone" type="tel" required maxLength={64} placeholder="(11) 91234-5678" disabled={pending} /></label><Button type="submit" disabled={pending}>Adicionar contato</Button></form><p>Inclua DDD. Números internacionais devem começar com + e código do país.</p></Card>
      <Card><h2>Importar contatos</h2><p>Até 500 contatos por importação e 64 KiB de texto. Uma linha por telefone, opcionalmente seguida de nome separado por vírgula, ponto e vírgula ou tabulação. Cabeçalho opcional: telefone,nome.</p>
        <form className="contactForm" onSubmit={(event) => submit(event, 'import')}><label>Arquivo CSV<input type="file" accept=".csv,.txt,text/csv,text/plain" disabled={pending} onChange={(event) => { void loadFile(event.target.files?.[0]); }} /></label><label>Ou cole os contatos<textarea required value={text} maxLength={65536} rows={7} disabled={pending} onChange={(event) => setText(event.target.value)} /></label><label>Adicionar à lista<select aria-label="Adicionar à lista" name="listId" disabled={pending}><option value="">Sem lista</option>{snapshot.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label><Button type="submit" disabled={pending}>Importar</Button></form><p>Duplicados são preservados; contatos com opt-out não são reativados pela importação.</p></Card></>}
    <Card><h2>Listas de audiência</h2>{canManage && <form className="memberForm" onSubmit={(event) => submit(event, 'list')}><label>Nome da lista<input name="name" required maxLength={100} disabled={pending} /></label><Button type="submit" disabled={pending}>Criar lista</Button></form>}
      {!snapshot.lists.length && <p>Nenhuma lista cadastrada.</p>}<ul>{snapshot.lists.map((list) => <li key={list.id} className="audienceRow"><span><strong>{list.name}</strong> · {list.contact_count} contatos</span>{canManage && <Button variant="secondary" disabled={pending} onClick={() => { if (window.confirm(`Excluir a lista ${list.name}? Os contatos serão preservados.`)) void mutate(`contact-lists/${list.id}`, 'DELETE'); }}>Excluir lista</Button>}</li>)}</ul></Card>
    <Card><h2>Contatos do workspace</h2><div className="tableScroll"><table><caption>{snapshot.total} contatos · até 100 por página</caption><thead><tr><th scope="col">Contato</th><th scope="col">Estado</th><th scope="col">Ações</th></tr></thead><tbody>{snapshot.contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.name || 'Sem nome'}</strong><small>{contact.phone_normalized}</small></td><td data-label="Estado">{contact.opted_out ? 'Bloqueado por opt-out' : 'Cadastrado'}</td><td data-label="Ações"><div className="memberActions messageActions"><Link href={`/contacts/${encodeURIComponent(contact.id)}?workspace=${encodeURIComponent(workspaceId)}`}>Consentimento RCS</Link>{canManage && <Button variant="secondary" disabled={pending || contact.opted_out} onClick={() => { if (window.confirm(`Registrar opt-out para ${contact.phone_normalized}? O contato ficará bloqueado para envios.`)) void mutate(`contacts/${contact.id}/opt-out`, 'POST', {}); }}>Registrar opt-out</Button>}</div></td></tr>)}</tbody></table></div>{!snapshot.total && <p>Nenhum contato cadastrado.</p>}<p>Cadastro não comprova consentimento, suporte a RCS ou disponibilidade para envio.</p></Card>
  </div>;
}
