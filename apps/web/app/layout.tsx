import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'RCS Sender',
  description: 'Mensagens RCS profissionais com liberdade de provedor.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
