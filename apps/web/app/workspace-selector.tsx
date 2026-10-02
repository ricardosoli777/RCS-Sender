'use client';

import { useRouter } from 'next/navigation';

export default function WorkspaceSelector({ workspaces, selected }: {
  workspaces: { id: string; name: string }[]; selected: string
}) {
  const router = useRouter();
  if (workspaces.length === 1) return <span className="workspaceName">{workspaces[0].name}</span>;
  return <label className="workspaceSelector">Workspace
    <select value={selected} onChange={(event) => { router.push(`/?workspace=${encodeURIComponent(event.target.value)}`); }}>
      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select>
  </label>;
}
