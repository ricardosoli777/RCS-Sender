import Link from 'next/link';
import AppShell,{ workspaceHref } from '../../app-shell';
import { apiGet,workspaceData,WorkspaceUnavailable } from '../../workspace';
import { Card } from '../../ui';
import ConsentEditor from '../consent-editor';
import type { ConsentSnapshot } from '../consent-model';
import ContactScore,{ type ScoreSnapshot } from '../score';
export default async function ContactConsentPage({ params,searchParams }: { params: Promise<{ contactId: string }>; searchParams: Promise<{ workspace?: string }> }) {
  const { contactId } = await params; const data = await workspaceData((await searchParams).workspace); if (!data) return <WorkspaceUnavailable />;
  let snapshot: ConsentSnapshot | null = null; let score: ScoreSnapshot | null = null;
  if (/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(contactId)) {
    try { const response = await apiGet(`/workspaces/${data.selected.id}/contacts/${contactId}/rcs-consents`,data.apiHeaders); if (response.ok) snapshot = await response.json(); } catch { /* Failed reads cannot authorize a write. */ }
    try { const response = await apiGet(`/workspaces/${data.selected.id}/contacts/${contactId}/score`,data.apiHeaders); if (response.ok) score = await response.json(); } catch { /* Failed reads are visible. */ }
  }
  return <AppShell data={data} active="/contacts"><Link href={workspaceHref('/contacts',data.selected.id)}>← Contatos do workspace</Link><div className="pageHeading"><div><p className="eyebrow">REGISTROS DO CONTATO</p><h1>Consentimento RCS</h1><p>Consulte declarações e revogações neste workspace.</p></div></div>
    {snapshot ? <div className="settingsGrid"><ConsentEditor key={`${data.selected.id}:${snapshot.contactId}:${snapshot.phone}:${snapshot.consents.map((item) => `${item.purpose}:${item.revision}`).join(',')}`} workspaceId={data.selected.id} initialSnapshot={snapshot} canManage={data.context.permissions.includes('contacts.manage')} /></div> : <Card><h2>Contato indisponível</h2><p role="alert">Não foi possível carregar os registros deste contato no workspace selecionado. Recarregue para tentar novamente.</p></Card>}
    {snapshot && <ContactScore snapshot={score} />}
  </AppShell>;
}
