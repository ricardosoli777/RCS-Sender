import { randomUUID } from 'node:crypto';
import { test,expect } from './fixtures';

test('message library preserves active versions, filters states and isolates reader access',async ({ page,browser }) => {
  test.setTimeout(90000);
  const suffix = randomUUID(); const origin = 'http://127.0.0.1:3100';
  const mutationHeaders = { Origin: origin,'X-RCS-Request': '1' };
  const registered = await page.request.post('/api/auth/register',{ headers: mutationHeaders,data: {
    name: 'Message Owner',email: `message-owner-${suffix}@example.test`,password: `test-only-${suffix}`,workspaceName: 'Message Library'
  } }); expect(registered.status()).toBe(201);
  const workspace = (await (await page.request.get('/api/workspaces')).json()).workspaces[0].id;
  const base = `/api/workspaces/${workspace}/messages`;
  await page.goto(`/messages?workspace=${workspace}`);
  await page.getByLabel('Nome da mensagem').fill('Welcome'); await page.getByLabel('Texto',{ exact: true }).fill('Version one');
  await page.getByRole('button',{ name: 'Criar rascunho',exact: true }).click();
  await expect(page).toHaveURL(/\/messages\/[a-f0-9-]+\?workspace=/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('button',{ name: 'Ativar versão 1',exact: true }).click();
  await expect(page.getByRole('button',{ name: 'Ativar versão 1',exact: true })).toHaveCount(0);
  await page.getByLabel('Nome da mensagem').fill('Welcome revised'); await page.getByLabel('Texto',{ exact: true }).fill('Version two');
  await page.getByRole('button',{ name: 'Salvar nova versão',exact: true }).click();
  await expect(page.getByRole('heading',{ name: 'Editar versão 2',exact: true })).toBeVisible();
  expect((await (await page.request.get(`${base}/${id}`)).json()).active.content.text).toBe('Version one');
  await expect(page.getByLabel('Prévia da mensagem').first()).toContainText('Version two');
  await page.getByLabel('Formato',{ exact: true }).selectOption('rich_card'); await page.getByLabel('Título',{ exact: true }).fill('Card title');
  await page.getByRole('button',{ name: 'Adicionar sugestão',exact: true }).click();
  await page.getByLabel('Rótulo da sugestão 1',{ exact: true }).fill('Continue'); await page.getByLabel('Valor da resposta 1',{ exact: true }).fill('journey_continue');
  await page.getByRole('button',{ name: 'Salvar nova versão',exact: true }).click();
  await expect(page.getByRole('heading',{ name: 'Editar versão 3',exact: true })).toBeVisible();
  const card = await (await page.request.get(`${base}/${id}`)).json();
  expect(card.current.content.card.suggestions[0].payload).toBe('journey_continue'); expect(card.active.version).toBe(1);
  await page.getByRole('link',{ name: 'Versão ativa',exact: true }).click();
  await expect(page.getByLabel('Prévia da mensagem').first()).toContainText('Version one');
  expect((await page.request.put(`${base}/${id}`,{ headers: mutationHeaders,data: {
    expectedVersion: 1,name: 'Stale',purpose: 'marketing',content: { type: 'text',text: 'Stale' }
  } })).status()).toBe(409);
  await page.getByRole('button',{ name: 'Duplicar como rascunho',exact: true }).click();
  await expect(page.getByRole('heading',{ name: 'Welcome revised (cópia)',exact: true })).toBeVisible();
  await expect(page.getByLabel('Prévia da mensagem').first()).toContainText('Version two');
  await page.getByRole('button',{ name: 'Arquivar',exact: true }).click();
  await expect(page.getByRole('button',{ name: 'Restaurar rascunho',exact: true })).toBeVisible();
  await page.getByRole('link',{ name: '← Biblioteca de mensagens',exact: true }).click();
  await page.getByRole('navigation',{ name: 'Filtrar mensagens por estado' }).getByRole('link',{ name: 'Arquivada',exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Welcome revised (cópia)');
  for (const width of [375,320]) {
    await page.setViewportSize({ width,height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const readerContext = await browser.newContext({ baseURL: origin,extraHTTPHeaders: {
    'x-rcs-edge-token': 'a'.repeat(64),'x-rcs-client-ip': '192.0.2.35'
  } });
  try {
    const reader = await readerContext.newPage(); const email = `message-reader-${suffix}@example.test`;
    expect((await reader.request.post('/api/auth/register',{ headers: mutationHeaders,data: {
      name: 'Message Reader',email,password: `test-only-${suffix}`,workspaceName: 'Reader own workspace'
    } })).status()).toBe(201);
    const readerWorkspace = (await (await reader.request.get('/api/workspaces')).json()).workspaces[0].id;
    expect((await reader.request.get(`${base}/${id}`)).status()).toBe(404);
    expect((await page.request.post(`/api/workspaces/${workspace}/members`,{ headers: mutationHeaders,data: { email,role: 'viewer' } })).status()).toBe(204);
    await reader.goto(`/messages?workspace=${workspace}`);
    await expect(reader.getByRole('heading',{ name: 'Nova mensagem',exact: true })).toHaveCount(0);
    await reader.getByRole('link',{ name: 'Welcome revised',exact: true }).click();
    await expect(reader.getByRole('button',{ name: 'Duplicar como rascunho',exact: true })).toHaveCount(0);
    await expect(reader.getByLabel('Prévia da mensagem')).toContainText('Version two');
    expect((await reader.request.patch(`${base}/${id}/status`,{ headers: mutationHeaders,data: { expectedVersion: 2,status: 'active' } })).status()).toBe(403);
    await reader.getByLabel('Workspace',{ exact: true }).selectOption(readerWorkspace);
    await expect(reader).toHaveURL(`${origin}/messages?workspace=${readerWorkspace}`);
    await expect(reader.getByRole('table')).not.toContainText('Welcome revised');
  } finally { await readerContext.close(); }
});
