import { randomUUID } from 'node:crypto';
import { test,expect } from './fixtures';
test('journey editor autosaves and preserves published versions',async ({ page }) => {
  const suffix = randomUUID(); const headers = { Origin: 'http://127.0.0.1:3100','X-RCS-Request': '1','x-rcs-client-ip': '192.0.2.51' };
  expect((await page.request.post('/api/auth/register',{ headers,data: { name: 'Journey Owner',email: `journey-${suffix}@example.test`,password: `test-only-${suffix}`,workspaceName: 'Journey Workspace' } })).status()).toBe(201);
  const workspace = (await (await page.request.get('/api/workspaces')).json()).workspaces[0].id;
  await page.goto(`/journeys?workspace=${workspace}`); await page.getByLabel('Nome da jornada',{ exact: true }).fill('Follow-up'); await page.getByRole('button',{ name: 'Criar jornada',exact: true }).click(); await expect(page.getByRole('heading',{ name: 'Follow-up',exact: true })).toBeVisible();
  await page.getByRole('button',{ name: 'Espera',exact: true }).click(); await page.getByLabel('Duração',{ exact: true }).fill('2'); await page.getByLabel('Próxima etapa',{ exact: true }).selectOption('end');
  await page.getByRole('button',{ name: 'Selecionar Início start',exact: true }).click(); const options = await page.getByLabel('Próxima etapa',{ exact: true }).locator('option').allTextContents(); const wait = options.find((label) => label.startsWith('Espera')); expect(wait).toBeTruthy(); await page.getByLabel('Próxima etapa',{ exact: true }).selectOption({ label: wait! });
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo' })).toBeVisible(); await page.getByRole('button',{ name: 'Validar fluxo',exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Fluxo válido' })).toBeVisible();
  page.once('dialog',(dialog) => { void dialog.accept(); }); await page.getByRole('button',{ name: 'Publicar versão',exact: true }).click(); await expect(page.getByRole('link',{ name: 'Versão 1',exact: true })).toBeVisible(); await page.getByRole('link',{ name: 'Versão 1',exact: true }).click(); await expect(page.getByText('Versão publicada: visualização somente.',{ exact: true })).toBeVisible(); await expect(page.getByRole('button',{ name: 'Publicar versão',exact: true })).toHaveCount(0);
});
