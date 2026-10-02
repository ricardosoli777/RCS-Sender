'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-RCS-Request': '1' } });
      if (response.ok || response.status === 401) {
        router.replace('/login');
        router.refresh();
      } else setError('Não foi possível sair. Tente novamente.');
    } catch {
      setError('Não foi possível conectar. Tente novamente.');
    } finally { setPending(false); }
  }
  return <div><button type="button" disabled={pending} onClick={logout}>{pending ? 'Saindo…' : 'Sair'}</button><span role="alert">{error}</span></div>;
}
