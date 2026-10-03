import { capabilities, type CapabilityMatrix, type CanonicalMessage, type ProviderLimits } from './contracts.js';

export function capabilityMatrix(verified: Partial<CapabilityMatrix> = {}): CapabilityMatrix {
  return Object.freeze(Object.fromEntries(capabilities.map((key) => [key, verified[key] ?? 'unknown'])) as Record<typeof capabilities[number], CapabilityMatrix[typeof capabilities[number]]>);
}
export function validateMessage(message: CanonicalMessage, matrix: CapabilityMatrix, limits: ProviderLimits): readonly string[] {
  const issues = new Set<string>();
  if (matrix[message.type] !== 'supported') issues.add('unsupported_capability');
  const text = (value: string, maximum?: number) => {
    if (!value.trim()) issues.add('empty_text');
    if (maximum !== undefined && Array.from(value).length > maximum) issues.add('text_limit');
  };
  const suggestions = (items: CanonicalMessage['suggestions']) => {
    if (limits.maxSuggestions !== undefined && (items?.length ?? 0) > limits.maxSuggestions) issues.add('suggestion_limit');
    for (const item of items ?? []) {
      text(item.text);
      if (matrix[item.type === 'reply' ? 'suggested_replies' : 'url_actions'] !== 'supported') issues.add('unsupported_capability');
      if (item.type === 'reply' && !item.payload.trim()) issues.add('invalid_reply');
      if (item.type === 'open_url') {
        try { const url = new URL(item.url); if (url.protocol !== 'https:' || url.username || url.password) issues.add('invalid_url'); }
        catch { issues.add('invalid_url'); }
      }
    }
  };
  const card = (value: { title: string; body: string; media?: { assetId: string }; suggestions?: CanonicalMessage['suggestions'] }) => {
    text(value.title, limits.maxTitleCharacters); text(value.body, limits.maxTextCharacters);
    if (value.media && (matrix.media !== 'supported' || !value.media.assetId)) issues.add('unsupported_media');
    suggestions(value.suggestions);
  };
  if (message.type === 'text') text(message.text, limits.maxTextCharacters);
  if (message.type === 'rich_card') card(message.card);
  if (message.type === 'carousel') {
    if (!message.cards.length || (limits.maxCards !== undefined && message.cards.length > limits.maxCards)) issues.add('card_limit');
    message.cards.forEach(card);
  }
  if ((message.type === 'media' || message.type === 'file') && !message.media.assetId) issues.add('invalid_media');
  suggestions(message.suggestions);
  return [...issues];
}
