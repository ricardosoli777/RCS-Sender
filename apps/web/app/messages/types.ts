export type MessageStatus = 'draft' | 'active' | 'archived';
export type MessagePurpose = 'marketing' | 'transactional' | 'authentication';
export type Suggestion = { type: 'reply'; text: string; payload: string } | { type: 'open_url'; text: string; url: string };
export type MessageCard = { title:string;body:string;media?:{assetId:string;mimeType:string};suggestions?:Suggestion[] };
export const archetypes={marketing:{launch:'Lançamento',offer:'Oferta',promotion:'Promoção',invitation:'Convite',reengagement:'Reengajamento',recovery:'Recuperação'},transactional:{confirmation:'Confirmação',reminder:'Lembrete',status_update:'Atualização de status',appointment:'Agendamento'},authentication:{OTP:'Código de acesso',verification:'Verificação',password_reset:'Redefinição de senha'}};
export type MessageContent = { type: 'text'; text: string; suggestions?: Suggestion[] } | {
  type: 'rich_card'; suggestions?: Suggestion[]; card: { title: string; body: string; media?: { assetId: string; mimeType: string }; suggestions?: Suggestion[] };
} | {type:'carousel';cards:MessageCard[];suggestions?:Suggestion[]} | {type:'media'|'file';media:{assetId:string;mimeType:string};suggestions?:Suggestion[]};
export type Message = { id: string; name: string; purpose: MessagePurpose; status: MessageStatus; current_version: number; active_version: number | null };
export type MessageVersion = { id: string; message_id: string; version: number; name: string; purpose: MessagePurpose; archetype?:string|null; content: MessageContent };
export type MessageDetail = { message: Message; current: MessageVersion; active: MessageVersion | null };
export const statusNames: Record<MessageStatus,string> = { draft: 'Rascunho',active: 'Ativa',archived: 'Arquivada' };
export const purposeNames: Record<MessagePurpose,string> = { marketing: 'Marketing',transactional: 'Transacional',authentication: 'Autenticação' };
export function messageHref(messageId: string,workspaceId: string) { return `/messages/${encodeURIComponent(messageId)}?workspace=${encodeURIComponent(workspaceId)}`; }
export function mutationError(status: number) {
  return status === 409 ? 'A mensagem mudou. Recarregue a página antes de tentar novamente.'
    : status === 403 ? 'Seu perfil não permite esta operação.'
    : status === 400 ? 'Confira o conteúdo e os limites da mensagem.'
    : 'Não foi possível salvar. Recarregue e tente novamente.';
}
