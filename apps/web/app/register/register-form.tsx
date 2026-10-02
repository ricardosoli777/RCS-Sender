'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterForm() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirmation')) { setError('As senhas não coincidem.'); return; }
    setPending(true); setError('');
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RCS-Request': '1' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password'), workspaceName: form.get('workspaceName') })
      });
      if (!response.ok) { setError((await response.json()).message ?? 'Não foi possível criar a conta.'); return; }
      router.replace('/'); router.refresh();
    } catch { setError('Não foi possível conectar. Tente novamente.'); }
    finally { setPending(false); }
  }
  return <form className="loginForm" onSubmit={submit}>
    <label htmlFor="name">Seu nome</label><input id="name" name="name" autoComplete="name" maxLength={100} required />
    <label htmlFor="email">E-mail</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required />
    <label htmlFor="workspaceName">Nome do workspace</label><input id="workspaceName" name="workspaceName" maxLength={100} required />
    <label htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} aria-describedby="password-help" required />
    <small id="password-help">Use pelo menos 12 caracteres.</small>
    <label htmlFor="confirmation">Confirme a senha</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required />
    <p role="alert" className="formError">{error}</p><button type="submit" disabled={pending}>{pending ? 'Criando…' : 'Criar conta'}</button>
  </form>;
}
