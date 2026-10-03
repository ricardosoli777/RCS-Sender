import type { Metadata } from 'next';
import { connection } from 'next/server';
import './styles.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';

export const metadata: Metadata = {
  title: 'RCS Sender',
  description: 'Mensagens RCS profissionais com liberdade de provedor.'
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return <html lang="pt-BR"><body>{children}</body></html>;
}
