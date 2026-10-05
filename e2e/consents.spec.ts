import { randomUUID } from 'node:crypto';
import { test,expect } from './fixtures';
test('contact consent UI records declarations and revocations while preserving opt-out and reader access',async ({ page,browser }) => {
  test.setTimeout(90000); const suffix = randomUUID(); const origin = 'http://127.0.0.1:3100';
  const headers = { Origin: origin,'X-RCS-Request': '1','x-rcs-client-ip': '192.0.2.41' };
  expect((await page.request.post('/api/auth/register',{ headers,data: { name: 'Consent Owner',email: `consent-owner-${suffix}@example.test`,password: `test-only-${suffix}`,workspaceName: 'Consent Workspace' } })).status()).toBe(201);
  const workspace = (await (await page.request.get('/api/workspaces')).json()).workspaces[0].id; const base = `/api/workspaces/${workspace}`;
  expect((await page.request.post(`${base}/contacts`,{ headers,data: { phone: '11987654321',name: 'Consent Contact' } })).status()).toBe(201);
  const contact = (await (await page.request.get(`${base}/contacts`)).json()).contacts[0];
  await page.goto(`/contacts?workspace=${workspace}`); await page.getByRole('link',{ name: 'Consentimento RCS',exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${contact.id}\\?workspace=${workspace}$`));
  await expect(page.getByRole('row').filter({ hasText: 'Autenticação' })).toContainText('Sem registro');
  const observed = new Date(Date.now()-60000).toISOString().slice(0,19);
  await page.getByLabel('Referência da evidência',{ exact: true }).fill('fixture/web-form/123'); await page.getByLabel('Data e horário da observação (UTC)',{ exact: true }).fill(observed);
  page.once('dialog',(dialog) => { void dialog.accept(); }); await page.getByRole('button',{ name: 'Registrar declaração ou revogação',exact: true }).click();
  await expect(page.getByText('Registro salvo. O histórico anterior foi preservado.',{ exact: true })).toBeVisible();
  const consentBase = `${base}/contacts/${contact.id}/rcs-consents`;
  let saved = await (await page.request.get(consentBase)).json(); expect(saved.consents[0]).toMatchObject({ state: 'granted',revision: 1 }); expect(saved.consents[1].state).toBe('unknown');
  expect((await page.request.post(consentBase,{ headers,data: { purpose: 'marketing',state: 'granted',source: 'web_form',evidenceReference: 'fixture/concurrent/125',observedAt: `${observed}.000Z`,expectedRevision: 1,expectedPhone: saved.phone } })).status()).toBe(201);
  await page.getByLabel('Estado a registrar',{ exact: true }).selectOption('revoked'); await page.getByLabel('Referência da evidência',{ exact: true }).fill('fixture/customer-request/124'); await page.getByLabel('Data e horário da observação (UTC)',{ exact: true }).fill(observed);
  page.once('dialog',(dialog) => { void dialog.accept(); }); await page.getByRole('button',{ name: 'Registrar declaração ou revogação',exact: true }).click();
  await expect(page.getByRole('alert').filter({hasText:'Recarregue antes de registrar novamente'})).toBeVisible(); await expect(page.getByRole('button',{ name: 'Registrar declaração ou revogação',exact: true })).toBeDisabled();
  await page.getByRole('button',{ name: 'Recarregar registros',exact: true }).click();
  await page.getByLabel('Estado a registrar',{ exact: true }).selectOption('revoked'); await page.getByLabel('Referência da evidência',{ exact: true }).fill('fixture/customer-request/126'); await page.getByLabel('Data e horário da observação (UTC)',{ exact: true }).fill(observed);
  page.once('dialog',(dialog) => { void dialog.accept(); }); await page.getByRole('button',{ name: 'Registrar declaração ou revogação',exact: true }).click();
  await expect(page.getByRole('table',{ name: /registro de cada finalidade/ })).toContainText('Consentimento revogado'); saved = await (await page.request.get(consentBase)).json(); expect(saved.consents[0]).toMatchObject({ state: 'revoked',revision: 3 });
  expect((await page.request.post(`${base}/contacts/${contact.id}/opt-out`,{ headers,data: {} })).status()).toBe(204); await page.reload(); await expect(page.getByText('Opt-out registrado.',{ exact: false })).toBeVisible();
  for (const width of [375,320]) {
    await page.setViewportSize({ width,height: 812 });
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((element) => {
      const rect = element.getBoundingClientRect(); return rect.right>window.innerWidth+1 && getComputedStyle(element).position !== 'absolute' && !element.closest('nav');
    }).map((element) => ({ tag: element.tagName,className: element.className,width: element.getBoundingClientRect().width })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth),JSON.stringify({ width,overflow })).toBe(true);
  }
  const readerContext = await browser.newContext({ baseURL: origin,extraHTTPHeaders: { 'x-rcs-edge-token': 'a'.repeat(64),'x-rcs-client-ip': '192.0.2.42' } });
  try {
    const reader = await readerContext.newPage(); const email = `consent-reader-${suffix}@example.test`;
    expect((await reader.request.post('/api/auth/register',{ headers: { Origin: origin,'X-RCS-Request': '1' },data: { name: 'Consent Reader',email,password: `test-only-${suffix}`,workspaceName: 'Reader Workspace' } })).status()).toBe(201);
    const ownWorkspace = (await (await reader.request.get('/api/workspaces')).json()).workspaces[0].id;
    expect((await reader.request.get(consentBase)).status()).toBe(404); expect((await page.request.post(`${base}/members`,{ headers,data: { email,role: 'viewer' } })).status()).toBe(204);
    await reader.goto(`/contacts/${contact.id}?workspace=${workspace}`); await expect(reader.getByRole('table',{ name: /registro de cada finalidade/ })).toContainText('Consentimento revogado'); await expect(reader.getByRole('button',{ name: 'Registrar declaração ou revogação',exact: true })).toHaveCount(0);
    await reader.getByLabel('Workspace',{ exact: true }).selectOption(ownWorkspace); await expect(reader).toHaveURL(`${origin}/contacts?workspace=${ownWorkspace}`);
  } finally { await readerContext.close(); }
});
