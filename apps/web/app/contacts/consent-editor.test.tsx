import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import ConsentEditor from './consent-editor';
import ContactsPanel from './panel';
import type { ConsentSnapshot } from './consent-model';
vi.mock('next/navigation',() => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const snapshot: ConsentSnapshot = { contactId: 'contact',phone: '+5511987654321',optedOut: true,consents: [{ purpose: 'marketing',state: 'granted',revision: 2,source: 'web_form',observedAt: '2026-10-03T10:00:00.000Z' },{ purpose: 'transactional',state: 'revoked',revision: 1,source: 'customer_request',observedAt: '2026-10-03T11:00:00.000Z' },{ purpose: 'authentication',state: 'unknown',revision: 0,source: null,observedAt: null }] };
describe('contact consent presentation',() => {
  it('shows all purpose states and persistent opt-out for readers without write controls',() => {
    const html = renderToStaticMarkup(<ConsentEditor workspaceId="workspace" initialSnapshot={snapshot} canManage={false} />);
    for (const label of ['Marketing','Transacional','Autenticação','Consentimento declarado','Consentimento revogado','Sem registro','permanece bloqueado','sem verificar a fonte externa']) expect(html).toContain(label);
    expect(html).not.toContain('<form'); expect(html).not.toContain('<button'); expect(html).not.toContain('evidenceReference');
  });
  it('offers explicit purpose, declaration/revocation, evidence and UTC fields to managers',() => {
    const html = renderToStaticMarkup(<ConsentEditor workspaceId="workspace" initialSnapshot={snapshot} canManage />);
    for (const label of ['Estado a registrar','Revogação de consentimento','Origem declarada','Referência da evidência','Data e horário da observação (UTC)','Revisão atual desta finalidade:','Registrar declaração ou revogação']) expect(html).toContain(label);
    expect(html).toMatch(/maxlength="128"/i); expect(html).toContain('datetime-local'); expect(html).not.toContain('name="phone"');
  });
  it('links contact summaries for readers while keeping opt-out changes restricted to managers',() => {
    const contacts = { contacts: [{ id: snapshot.contactId,name: 'Example',phone_normalized: snapshot.phone,opted_out: true }],lists: [],total: 1 };
    const html = renderToStaticMarkup(<ContactsPanel workspaceId="workspace" snapshot={contacts} canManage={false} />);
    expect(html).toContain('/contacts/contact?workspace=workspace'); expect(html).toContain('Consentimento RCS'); expect(html).not.toContain('Registrar opt-out');
  });
});
