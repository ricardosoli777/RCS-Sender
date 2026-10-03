import type { CanonicalError, ErrorCode } from './contracts.js';
const messages: Record<ErrorCode, string> = {
  invalid_credentials: 'Credenciais inválidas.', invalid_message: 'Mensagem inválida.', unsupported_capability: 'Recurso não suportado.',
  rate_limited: 'Limite do provedor atingido.', unavailable: 'Provedor temporariamente indisponível.', rejected: 'Mensagem rejeitada pelo provedor.', unknown: 'Falha no provedor.'
};
// External error bodies must be mapped by their adapter; never pass them through to clients or logs.
export function canonicalError(code: ErrorCode, retryAfterSeconds?: number): CanonicalError {
  return Object.freeze({ code, message: messages[code], retryable: code === 'rate_limited' || code === 'unavailable',
    ...(code === 'rate_limited' && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds! >= 0 ? { retryAfterSeconds } : {}) });
}
