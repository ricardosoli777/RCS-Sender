'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RCS-Request': '1' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
      });
      if (!response.ok) {
        const result = await response.json();
        setError(result.message ?? 'Não foi possível entrar.');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Não foi possível conectar. Tente novamente.');
    } finally {
      setPending(false);
    }
  }
  return <form className="loginForm" onSubmit={submit}>
    <label htmlFor="email">E-mail</label>
    <input id="email" name="email" type="email" autoComplete="username" maxLength={254} required />
    <label htmlFor="password">Senha</label>
    <input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required />
    <p role="alert" className="formError">{error}</p>
    <button type="submit" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
  </form>;
}
