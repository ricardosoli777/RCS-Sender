import { describe,expect,it } from 'vitest';
import { campaignForm,campaignStatusLabel,formIssues,reviewIssue,utcInput,type Campaign } from './model';
describe('campaign editor configuration',() => {
  const initial: Campaign = { id: 'campaign',name: 'Launch',objective: 'Recovery',status: 'draft',revision: 5,provider_connection_id: 'connection',agent_id: 'agent',audience_list_id: 'list',message_version_id: 'old-version',scheduled_at: '2027-01-02T03:04:05.678Z' };
  it('preserves pinned references and exact schedule until explicitly edited',() => {
    const form = campaignForm(initial); form.objective = 'Edited';
    expect(form).toMatchObject({ messageVersionId: 'old-version',scheduledAt: '2027-01-02T03:04:05.678Z',providerConnectionId: 'connection',agentId: 'agent',audienceListId: 'list' }); expect(initial.objective).toBe('Recovery');
  });
  it('permits partial drafts without inventing audience or connection selections',() => {
    const form = campaignForm(); form.name = 'Draft'; form.objective = 'Invite';
    expect(formIssues(form)).toEqual([]); expect(form.messageVersionId).toBeNull(); expect(form.audienceListId).toBeNull();
  });
  it('uses explicit UTC and rejects expired or normalized invalid dates',() => {
    const form = campaignForm(initial); const now = Date.parse('2026-10-03T00:00:00.000Z');
    form.scheduledAt = utcInput('2027-01-02T03:04'); expect(form.scheduledAt).toBe('2027-01-02T03:04:00.000Z'); expect(formIssues(form,now)).toEqual([]);
    for (const date of ['2027-02-31T03:04','2026-10-02T03:04']) { form.scheduledAt = utcInput(date); expect(formIssues(form,now).join()).toContain('UTC'); }
    form.scheduledAt = utcInput(''); expect(formIssues(form,now)).toEqual([]);
  });
  it('presents pending checks without exposing raw internal issue codes',() => {
    expect(reviewIssue('runtime_not_available')).toContain('ainda não está disponível');
    expect(reviewIssue('message_version_not_active')).toContain('não é mais a versão ativa');
    expect(reviewIssue('unknown_sensitive_code')).not.toContain('unknown_sensitive_code');
  });
  it('labels completed simulations separately from campaign execution',() => {
    expect(campaignStatusLabel({ ...initial,status: 'completed',execution_mode: 'simulation' })).toBe('Simulação · Concluída');
    expect(campaignStatusLabel(initial)).toBe('Rascunho');
  });
});
