import { randomUUID } from 'node:crypto';
import { test,expect } from './fixtures';
test('available providers can save private credentials without testing or sending automatically',async({page})=>{
  const suffix=randomUUID();const headers={Origin:'http://127.0.0.1:3100','X-RCS-Request':'1'};
  expect((await page.request.post('/api/auth/register',{headers,data:{name:'Integration Owner',email:`integration-${suffix}@example.test`,password:`test-only-${suffix}`,workspaceName:'Integration Workspace'}})).status()).toBe(201);
  const workspace=(await(await page.request.get('/api/workspaces')).json()).workspaces[0].id;
  let tested=0;await page.route(`**/api/workspaces/${workspace}/providers/*/test`,async route=>{tested++;expect(route.request().postDataJSON()).toEqual({});await route.fulfill({json:{status:'disconnected',error:{code:'unknown'}}});});
  await page.goto(`/integrations?workspace=${workspace}`);
  await expect(page.getByText('Disponível para configurar',{exact:true})).toHaveCount(5);
  const twilio=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Twilio RCS',exact:true})});
  await twilio.getByLabel('Nome da conexão',{exact:true}).fill('QA Twilio');
  await twilio.getByLabel('accountSid',{exact:true}).fill(`AC${'a'.repeat(32)}`);
  await twilio.getByLabel('authToken',{exact:true}).fill('fixture-private-token-never-real');
  await twilio.getByLabel('sender',{exact:true}).fill(`sender-${suffix}`);
  await twilio.getByLabel('webhookUrl',{exact:true}).fill(`https://example.test/webhooks/rcs/twilio?connectionId=${randomUUID()}`);
  await twilio.getByRole('button',{name:'Salvar conexão',exact:true}).click();
  await expect(twilio.getByText('Credenciais salvas · não verificada',{exact:false})).toBeVisible();
  expect(tested).toBe(0);
  const response=await page.request.get(`/api/workspaces/${workspace}/providers`);expect(response.status()).toBe(200);const stored=await response.json();expect(JSON.stringify(stored)).not.toContain('fixture-private-token');expect(stored.connections[0].status).toBe('unverified');
  await twilio.getByRole('button',{name:'Testar conexão QA Twilio',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'O adaptador não confirmou'})).toBeVisible();expect(tested).toBe(1);
  for(const width of [375,320]){await page.setViewportSize({width,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  const icon=await page.request.get('/icon.svg');expect(icon.status()).toBe(200);expect(icon.headers()['content-type']).toContain('image/svg+xml');
});
