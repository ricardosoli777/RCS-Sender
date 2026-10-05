import { randomUUID } from 'node:crypto';
import { test,expect } from './fixtures';

test('library actions edit, save and delete drafts with visible icons and journey guidance',async({page})=>{
  const suffix=randomUUID();const headers={Origin:'http://127.0.0.1:3100','X-RCS-Request':'1'};
  expect((await page.request.post('/api/auth/register',{headers,data:{name:'Library Owner',email:`library-${suffix}@example.test`,password:`test-only-${suffix}`,workspaceName:'Library Workspace'}})).status()).toBe(201);
  const workspace=(await(await page.request.get('/api/workspaces')).json()).workspaces[0].id;
  const base=`/api/workspaces/${workspace}`;
  const message=(await(await page.request.post(`${base}/messages`,{headers,data:{name:'Card draft',purpose:'marketing',content:{type:'rich_card',card:{title:'First title',body:'First body'}}}})).json()).message;
  await page.goto(`/messages?workspace=${workspace}`);
  await page.getByRole('row').filter({hasText:'Card draft'}).getByRole('link',{name:'Editar',exact:true}).click();
  await page.getByLabel('Título',{exact:true}).fill('Edited title');
  await page.getByRole('button',{name:'Salvar nova versão',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Editar versão 2',exact:true})).toBeVisible();
  expect((await(await page.request.get(`${base}/messages/${message.id}`)).json()).current.content.card.title).toBe('Edited title');
  await page.goto(`/messages?workspace=${workspace}`);
  const messageRow=page.getByRole('row').filter({hasText:'Card draft'});
  await expect(messageRow.getByRole('button',{name:'Excluir',exact:true}).locator('svg')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await messageRow.getByRole('button',{name:'Excluir',exact:true}).click();
  await expect(messageRow).toHaveCount(0);

  const campaign=(await(await page.request.post(`${base}/campaigns`,{headers,data:{name:'Campaign draft',objective:'First objective'}})).json()).campaign;
  await page.goto(`/campaigns?workspace=${workspace}`);
  await page.getByRole('row').filter({hasText:'Campaign draft'}).getByRole('link',{name:'Editar',exact:true}).click();
  await page.getByLabel('Objetivo',{exact:true}).fill('Edited objective');
  await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Editar rascunho · revisão 2',exact:true})).toBeVisible();
  expect((await(await page.request.get(`${base}/campaigns/${campaign.id}`)).json()).campaign.objective).toBe('Edited objective');
  await page.goto(`/campaigns?workspace=${workspace}`);
  const campaignRow=page.getByRole('row').filter({hasText:'Campaign draft'});
  page.once('dialog',dialog=>dialog.accept());await campaignRow.getByRole('button',{name:'Excluir',exact:true}).click();await expect(campaignRow).toHaveCount(0);

  await page.goto(`/journeys?workspace=${workspace}`);
  await page.getByLabel('Nome da jornada',{exact:true}).fill('Journey draft');await page.getByRole('button',{name:'Criar jornada',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Monte a sequência que cada lead vai percorrer'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Mensagem',exact:true})).toContainText('Envia uma mensagem');
  await page.getByRole('button',{name:'Espera',exact:true}).click();
  await expect(page.getByText('Duração 1 + Dias: cada lead espera um dia antes de seguir.',{exact:false})).toBeVisible();
  await page.getByLabel('Duração',{exact:true}).fill('2');
  await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Rascunho salvo'})).toBeVisible();
  const id=new URL(page.url()).pathname.split('/').at(-1);
  expect((await(await page.request.get(`${base}/journeys/${id}`)).json()).graph.nodes.find((node:{type:string})=>node.type==='wait').config.amount).toBe(2);
  for(const width of [375,320]){await page.setViewportSize({width,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.goto(`/journeys?workspace=${workspace}`);
  const journeyRow=page.getByRole('row').filter({hasText:'Journey draft'});
  page.once('dialog',dialog=>dialog.accept());await journeyRow.getByRole('button',{name:'Excluir',exact:true}).click();await expect(journeyRow).toHaveCount(0);
});
