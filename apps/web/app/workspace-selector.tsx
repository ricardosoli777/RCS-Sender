'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export default function WorkspaceSelector({ workspaces, selected }: {
  workspaces: { id: string; name: string }[]; selected: string
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (workspaces.length === 1) return <span className="workspaceName">{workspaces[0].name}</span>;
  return <div className="workspaceSelector"><label htmlFor="workspace-select">Workspace</label>
    <select id="workspace-select" value={selected} onChange={(event) => { const query = new URLSearchParams(searchParams); query.set('workspace', event.target.value); router.push(`${pathname}?${query}`); }}>
      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select>
  </div>;
}
