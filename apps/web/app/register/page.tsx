import Link from 'next/link';
import RegisterForm from './register-form';

export default function Register() {
  return <main className="shell loginShell">
    <div className="brand"><span className="brandIcon">◈</span> RCS Sender</div>
    <section className="card loginCard" aria-labelledby="register-title">
      <p className="eyebrow">COMECE AQUI</p><h1 id="register-title">Crie sua conta</h1>
      <p>Seu workspace reúne a equipe e a operação de mensagens.</p>
      <RegisterForm /><p><Link href="/login">Já tenho uma conta</Link></p>
    </section>
  </main>;
}
