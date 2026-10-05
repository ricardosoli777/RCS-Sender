import { randomUUID } from 'node:crypto';
import { test,expect } from './fixtures';
test('rich-card title, text, image and URL button remain usable before and after saving',async({page,context})=>{
  const suffix=randomUUID();const headers={Origin:'http://127.0.0.1:3100','X-RCS-Request':'1'};
  expect((await page.request.post('/api/auth/register',{headers,data:{name:'Button Owner',email:`button-${suffix}@example.test`,password:`test-only-${suffix}`,workspaceName:'Button Workspace'}})).status()).toBe(201);
  const workspace=(await(await page.request.get('/api/workspaces')).json()).workspaces[0].id;
  await page.goto(`/messages?workspace=${workspace}`);
  await page.getByLabel('Nome da mensagem',{exact:true}).fill('Offer with button');await page.getByLabel('Formato',{exact:true}).selectOption('rich_card');
  await page.getByLabel('Título',{exact:true}).fill('Minha oferta');await page.getByLabel('Texto',{exact:true}).fill('Confira todos os detalhes');
  await page.getByLabel('Enviar imagem',{exact:true}).setInputFiles({name:'qa.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  await expect(page.getByRole('img',{name:'Imagem da mensagem',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Adicionar sugestão',exact:true}).click();await page.getByLabel('Tipo da sugestão 1',{exact:true}).selectOption('open_url');
  await page.getByLabel('Rótulo da sugestão 1',{exact:true}).fill('Ver oferta');await page.getByLabel('URL da ação 1',{exact:true}).fill('https://example.test/oferta');
  await context.route('https://example.test/oferta',route=>route.fulfill({contentType:'text/html',body:'<h1>Destino QA</h1>'}));
  const preview=page.getByLabel('Prévia da mensagem',{exact:true});const popupPromise=page.waitForEvent('popup');await preview.getByRole('link',{name:'Ver oferta',exact:true}).click();
  const popup=await popupPromise;await expect(popup.getByRole('heading',{name:'Destino QA'})).toBeVisible();expect(await popup.evaluate(()=>window.opener===null)).toBe(true);await popup.close();
  await page.getByRole('button',{name:'Adicionar sugestão',exact:true}).click();await page.getByLabel('Rótulo da sugestão 2',{exact:true}).fill('Tenho interesse');await page.getByLabel('Valor da resposta 2',{exact:true}).fill('interest');
  await preview.getByRole('button',{name:'Tenho interesse',exact:true}).click();await expect(preview.getByRole('status')).toContainText('Nenhuma resposta foi enviada');
  await page.getByRole('button',{name:'Criar rascunho',exact:true}).click();await expect(page).toHaveURL(/\/messages\/[a-f0-9-]+\?workspace=/);
  await expect(page.getByLabel('Prévia da mensagem').first().getByRole('link',{name:'Ver oferta',exact:true})).toHaveAttribute('href','https://example.test/oferta');
  const stored=await(await page.request.get(`/api/workspaces/${workspace}/messages/${new URL(page.url()).pathname.split('/').at(-1)}`)).json();
  expect(stored.current.content.card).toMatchObject({title:'Minha oferta',body:'Confira todos os detalhes',media:{mimeType:'image/png'}});
  for(const width of [375,320]){await page.setViewportSize({width,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
