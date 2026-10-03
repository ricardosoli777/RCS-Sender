import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { trustedApiHeaders } from './security/trusted-proxy';
import LogoutButton from './logout-button';

import type { Role } from './roles';
export { roleNames } from './roles';
export type Workspace = { id: string; name: string; role: Role };
export type WorkspaceData = { user: { id: string; name: string; email: string }; workspaces: Workspace[]; selected: Workspace;
  context: { user_id: string; workspace_id: string; role: Role; permissions: string[] }; apiHeaders: Record<string, string> };
export async function workspaceData(requested?: string): Promise<WorkspaceData | null> {
  const cookie = (await cookies()).toString();
  const apiHeaders = { ...trustedApiHeaders(new Headers(await headers())), cookie };
  let user: WorkspaceData['user'] | undefined;
  try {
    if (cookie && process.env.API_URL) {
      const response = await apiGet('/auth/me', apiHeaders);
      if (response.ok) user = (await response.json()).user;
    }
  } catch { /* Authentication fails closed. */ }
  if (!user) redirect('/login');
  try {
    const response = await apiGet('/workspaces', apiHeaders);
    if (!response.ok) return null;
    const workspaces: Workspace[] = (await response.json()).workspaces;
    const selected = workspaces.find((item) => item.id === (requested ?? workspaces[0]?.id));
    if (!selected) return null;
    const contextResponse = await apiGet(`/workspaces/${selected.id}/context`, apiHeaders);
    if (!contextResponse.ok) return null;
    return { user, workspaces, selected, context: (await contextResponse.json()).context, apiHeaders };
  } catch { return null; }
}
export function apiGet(path: string, apiHeaders: Record<string, string>) {
  return fetch(new URL(path, process.env.API_URL!), { headers: apiHeaders, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(5000) });
}
export function WorkspaceUnavailable() {
  return <main className="shell loginShell"><h1>Workspace indisponível</h1><p>Você precisa de um vínculo ativo com o workspace para acessá-lo. Tente novamente ou entre em contato com o proprietário.</p><a href="/">Voltar ao meu workspace</a><LogoutButton /></main>;
}
