import LoginForm from './login-form';
import Link from 'next/link';

export default function Login() {
  return <main className="shell loginShell">
    <div className="brand"><span className="brandIcon">◈</span> RCS Sender</div>
    <section className="card loginCard" aria-labelledby="login-title">
      <p className="eyebrow">BEM-VINDO</p>
      <h1 id="login-title">Entre na sua conta</h1>
      <p>Acesse sua plataforma de mensagens RCS.</p>
      <LoginForm />
      <p><Link href="/register">Criar uma conta</Link></p>
    </section>
  </main>;
}
