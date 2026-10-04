export const campaignStatusNames = { draft: 'Rascunho',scheduled: 'Agendada',ready: 'Pronta',queued: 'Na fila',running: 'Em execução',paused: 'Pausada',completed: 'Concluída',cancelled: 'Cancelada',failed: 'Falhou' };
export type CampaignStatus = keyof typeof campaignStatusNames;
export type Campaign = { id: string; name: string; objective: string; status: CampaignStatus; revision: number; execution_mode?: 'simulation' | 'dispatch' | null; provider_connection_id: string | null; agent_id: string | null; audience_list_id: string | null; message_version_id: string | null; scheduled_at: string | null };
export type SimulationSnapshot = { campaign: Campaign; run: { id: string; mode: 'simulation'; message_version_id: string; not_before: string | null }; counts: { total: number; pending: number; simulated: number; suppressed: number; cancelled: number }; automation: { status: 'pending' | 'completed' | 'discarded' | 'dead'; attempts: number; available_at: string } | null; realSending: false };
export type DispatchPreparationSnapshot = { runId: string; campaignId: string; revision: number; status: CampaignStatus; confirmed: boolean; counts: { total: number; eligible: number; suppressed: number; unavailable: number }; executionAvailable: false };
export function campaignStatusLabel(campaign: Campaign) {
  if (campaign.execution_mode === 'dispatch' && campaign.status === 'ready') return 'Preparação de despacho';
  return `${campaign.execution_mode === 'simulation' ? 'Simulação · ' : campaign.execution_mode === 'dispatch' ? 'Despacho · ' : ''}${campaignStatusNames[campaign.status]}`;
}
export type CampaignReview = { campaign: Campaign; audience: { total: number; optedOut: number; remaining: number }; eligibility: { source: 'saved_checks'; checkedAt: string; counts: { total: number; blocked: number; eligible: number; ineligible: number; unknown: number; stale: number; unchecked: number } }; message: { id: string; message_id: string; version: number } | null; issues: string[]; executionAvailable: false };
export type OptionKind = 'connections' | 'audiences' | 'messages';
export type CampaignOption = { id: string; name: string; agentId?: string | null; status?: string; contactCount?: number; messageId?: string; version?: number };
export type CampaignForm = { name: string; objective: string; providerConnectionId: string | null; agentId: string | null; audienceListId: string | null; messageVersionId: string | null; scheduledAt: string | null };
export function campaignHref(id: string,workspaceId: string) { return `/campaigns/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspaceId)}`; }
export function campaignForm(campaign?: Campaign): CampaignForm {
  return { name: campaign?.name ?? '',objective: campaign?.objective ?? '',providerConnectionId: campaign?.provider_connection_id ?? null,agentId: campaign?.agent_id ?? null,audienceListId: campaign?.audience_list_id ?? null,messageVersionId: campaign?.message_version_id ?? null,scheduledAt: campaign?.scheduled_at ?? null };
}
export function utcInput(value: string) { return value ? `${value}:00.000Z` : null; }
export function formIssues(form: CampaignForm,now = Date.now()): string[] {
  const issues: string[] = [];
  for (const [value,max,label] of [[form.name,100,'Nome'],[form.objective,500,'Objetivo']] as const) if (!value.trim() || Array.from(value).length > max || /[\x00-\x1f\x7f]/.test(value)) issues.push(`${label}: preencha até ${max} caracteres válidos.`);
  if (form.agentId && (Array.from(form.agentId).length > 128 || !form.agentId.trim() || /[\x00-\x1f\x7f]/.test(form.agentId))) issues.push('Agente: use até 128 caracteres válidos.');
  if (form.scheduledAt) {
    const date = new Date(form.scheduledAt); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(form.scheduledAt) || !Number.isFinite(date.getTime()) || date.getTime() <= now || date.toISOString() !== form.scheduledAt) issues.push('Escolha uma data futura válida em UTC ou remova a data.');
  }
  return issues;
}
export function campaignError(status: number) { return status === 409 ? 'A campanha mudou ou não permite esta operação. Recarregue antes de tentar novamente.' : status === 403 ? 'Seu perfil não permite alterar esta campanha.' : status === 400 ? 'Confira os dados, referências e a data da campanha.' : 'Não foi possível salvar. Recarregue para conferir o estado da campanha.'; }
const issueNames: Record<string,string> = {
  campaign_not_draft: 'Esta campanha não está em rascunho.',agent_missing: 'Selecione ou informe o agente.',provider_missing: 'Selecione uma conexão.',connection_not_verified: 'A conexão não tem um teste salvo como conectado.',agent_binding_mismatch: 'O agente difere do agente vinculado à conexão.',provider_inactive: 'O adaptador da conexão está inativo ou indisponível.',message_missing: 'Selecione uma versão de mensagem.',message_version_not_active: 'A versão vinculada não é mais a versão ativa da mensagem.',audience_missing: 'Selecione uma lista de audiência.',audience_empty: 'A audiência está vazia.',audience_fully_opted_out: 'Todos os contatos da audiência têm opt-out registrado.',schedule_in_past: 'A data configurada já passou.',runtime_not_available: 'O motor de envio real ainda não está disponível.',message_unsupported_capability: 'A mensagem exige uma capacidade não suportada ou desconhecida pelo adaptador.',message_unsupported_media: 'A mídia não tem suporte confirmado pelo adaptador.',message_text_limit: 'Texto ou título excede um limite declarado pelo adaptador.',message_suggestion_limit: 'As sugestões excedem um limite declarado pelo adaptador.',message_empty_text: 'A mensagem contém texto vazio.',message_invalid_reply: 'A mensagem contém resposta sugerida inválida.',message_invalid_url: 'A mensagem contém URL inválida.',
  eligibility_unchecked: 'Há contatos sem consulta de elegibilidade salva nesta conexão.',eligibility_stale: 'Há consultas expiradas ou invalidadas por alteração de telefone ou conexão.',eligibility_unknown: 'Há contatos com elegibilidade desconhecida ou sem suporte confirmado pelo adaptador.',eligibility_ineligible: 'Há contatos marcados como não elegíveis nas consultas válidas.',audience_no_cached_eligible: 'Não há contatos com elegibilidade válida confirmada no cache.',provider_credentials_missing: 'A conexão não possui credenciais salvas.',agent_binding_missing: 'A conexão não possui agente vinculado.',private_media_not_published: 'A mensagem usa mídia privada ainda sem publicação para o fornecedor.',
};
export function reviewIssue(code: string) { return issueNames[code] ?? 'Há uma verificação pendente na configuração da campanha.'; }
export function scheduleLabel(value: string | null) { return value ? `${value.slice(0,19).replace('T',' ')} UTC` : 'Sem data configurada'; }
