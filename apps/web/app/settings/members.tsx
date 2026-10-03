'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '../ui';
import { roleNames, type Role } from '../roles';

export type Member = { id: string; user_id: string; name: string; email: string; role: Role; status: string };
type Action = { member: Member; kind: 'role' | 'remove' };
// Keep browser imports free of server-only cookies, headers and proxy secrets.
const roles: Role[] = ['owner', 'admin', 'operator', 'viewer'];
export default function Members({ workspaceId, members }: { workspaceId: string; members: Member[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [role, setRole] = useState<Role>('viewer');
  useEffect(() => {
    if (action) { dialog.current?.showModal(); cancel.current?.focus(); }
  }, [action]);
  async function mutate(path: string, method: string, body?: object) {
    setPending(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/members${path}`, { method,
        headers: { 'X-RCS-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) {
        const messages: Record<number, string> = { 401: 'Sua sessão expirou. Entre novamente.', 403: 'Você não tem permissão para gerenciar esta equipe.', 404: 'Membro indisponível. Confira se a conta já existe.', 409: 'Esta operação não pode ser concluída.' };
        let message = messages[response.status] ?? 'Não foi possível salvar. Tente novamente.';
        if (response.status === 409) {
          const result = await response.json().catch(() => null);
          if (result?.message === 'O workspace precisa manter um proprietário ativo.' || result?.message === 'Esta conta já é membro do workspace.') message = result.message;
        }
        setError(message); return false;
      }
      setSuccess('Equipe atualizada.');
      router.refresh();
      return true;
    } catch { setError('Não foi possível conectar. Tente novamente.'); return false; }
    finally { setPending(false); }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (await mutate('', 'POST', { email: String(fields.get('email')).trim(), role: fields.get('role') })) form.reset();
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const saved = await mutate(`/${action.member.id}`, action.kind === 'remove' ? 'DELETE' : 'PATCH', action.kind === 'role' ? { role } : undefined);
    if (saved) { dialog.current?.close(); setAction(null); }
  }
  function open(member: Member, kind: Action['kind']) { setError(''); setSuccess(''); setRole(member.role); setAction({ member, kind }); }
  return <Card><h2>Membros da equipe</h2><p>Adicione pessoas que já possuem uma conta no RCS Sender. Não é enviado convite por e-mail.</p>
    <form className="memberForm" onSubmit={add}><label>E-mail do membro<input type="email" name="email" required maxLength={254} autoComplete="off" placeholder="pessoa@empresa.com" disabled={pending} /></label><label>Perfil do novo membro<select name="role" defaultValue="viewer" disabled={pending}>{roles.map((item) => <option key={item} value={item}>{roleNames[item]}</option>)}</select></label><Button disabled={pending} type="submit">{pending ? 'Salvando…' : 'Adicionar membro'}</Button></form>
    {!action && <p role="alert" className="formError">{error}</p>}<p role="status" className="formSuccess">{success}</p>
    <div className="tableScroll"><table><caption>{members.length} {members.length === 1 ? 'membro ativo' : 'membros ativos'} neste workspace</caption><thead><tr><th scope="col">Pessoa</th><th scope="col">Perfil</th><th scope="col">Ações</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td>{roleNames[member.role]}</td><td><div className="memberActions"><Button variant="secondary" disabled={pending} onClick={() => open(member, 'role')} aria-label={`Alterar perfil de ${member.name}`}>Alterar perfil</Button><Button variant="secondary" disabled={pending} onClick={() => open(member, 'remove')} aria-label={`Remover ${member.name}`}>Remover</Button></div></td></tr>)}</tbody></table></div>
    <dialog ref={dialog} className="dialog" aria-labelledby="member-dialog-title" onCancel={(event) => { if (pending) event.preventDefault(); }} onClose={() => setAction(null)}>
      {action && <form onSubmit={confirm}><h2 id="member-dialog-title">{action.kind === 'remove' ? 'Remover membro' : 'Alterar perfil'}</h2><p>{action.kind === 'remove' ? `${action.member.name} perderá o acesso a este workspace.` : `Defina o perfil de ${action.member.name}.`} A equipe precisa manter ao menos um proprietário.</p>{action.kind === 'role' && <label>Novo perfil<select value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={pending}>{roles.map((item) => <option key={item} value={item}>{roleNames[item]}</option>)}</select></label>}<p className="formError" role="alert">{error}</p><div className="dialogActions"><Button type="button" variant="secondary" ref={cancel} disabled={pending} onClick={() => dialog.current?.close()}>Cancelar</Button><Button type="submit" variant={action.kind === 'remove' ? 'danger' : 'primary'} disabled={pending}>{pending ? 'Salvando…' : action.kind === 'remove' ? 'Confirmar remoção' : 'Salvar perfil'}</Button></div></form>}
    </dialog>
  </Card>;
}
