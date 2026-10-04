import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GoogleRbmProvider } from './google-rbm.js';
import type { Credentials, ProviderContext } from './contracts.js';

// Manual proof only: never enabled by CI or ordinary pnpm test.
// No environment values, account payloads or provider exceptions are printed.
async function proofContext(): Promise<ProviderContext> {
  const path = process.env.RCS_GOOGLE_PROOF_CREDENTIALS_FILE;
  if (!path) throw new Error('Informe o arquivo local de credenciais de prova.');
  let credentials: Credentials;
  try { credentials = JSON.parse(await readFile(path, 'utf-8')) as Credentials; }
  catch { throw new Error('Não foi possível ler as credenciais de prova.'); }
  const provider = new GoogleRbmProvider();
  if (!credentials || typeof credentials !== 'object' || !provider.validateCredentials(credentials, 'test')) throw new Error('Credenciais de prova inválidas.');
  return { workspaceId: 'manual-proof-workspace', connectionId: 'manual-proof-connection', environment: 'test', credentials,
    signal: AbortSignal.timeout(20000) };
}

describe('Google RCS manual live proof', () => {
  it.skipIf(process.env.RUN_GOOGLE_RBM_TESTS !== '1')('reads the configured agent using a real service account', async () => {
    const provider = new GoogleRbmProvider(); const context = await proofContext();
    const result = await provider.testConnection(context);
    // The assertion reports only a boolean, never the raw remote response.
    expect(result.status === 'connected').toBe(true);
  }, 30000);

  it.skipIf(process.env.RUN_GOOGLE_RBM_TESTS !== '1' || process.env.RUN_GOOGLE_RBM_SEND_TEST !== '1')('sends one explicit text proof to the configured consenting tester', async () => {
    const recipient = process.env.RCS_GOOGLE_PROOF_RECIPIENT;
    if (!recipient || !/^\+[1-9]\d{7,14}$/.test(recipient)) throw new Error('Informe um destinatário tester válido.');
    const provider = new GoogleRbmProvider(); const context = await proofContext();
    const result = await provider.send(context, { agentId: context.credentials.agentName!.split('/')[3]!, recipient,
      idempotencyKey: randomUUID(), message: { type: 'text', text: 'Prova técnica RCS Sender — mensagem única para dispositivo de teste.' } });
    expect(result.accepted).toBe(true);
  }, 30000);
});
