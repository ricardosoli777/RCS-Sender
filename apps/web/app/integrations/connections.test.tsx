import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it,expect } from 'vitest';
import Connections,{type Provider} from './connections';
const provider:Provider={metadata:{id:'fixture',name:'Fixture',environments:['test'],credentialSchema:[{key:'apiToken',label:'Token da API',required:true,secret:true}]},active:true,capabilities:{text:'supported'}};
describe('integration credential privacy and readiness',()=>{
  it('offers credential entry without treating an untested connection as verified',()=>{
    const html=renderToStaticMarkup(<Connections workspace="workspace" providers={[provider]} initial={[{id:'connection',provider_id:'fixture',name:'My account',environment:'test',status:'unverified',external_agent_id:'agent'}]} origin="https://example.test"/>);
    expect(html).toContain('type="password"');expect(html).toContain('não verificada');expect(html).not.toContain('Conexão verificada');expect(html).toContain('Testar conexão My account');expect(html).toContain('/webhooks/rcs/fixture?connectionId=connection');
  });
  it('does not offer duplicate creation when reading existing connections failed',()=>{
    const html=renderToStaticMarkup(<Connections workspace="workspace" providers={[provider]} initial={null} origin="https://example.test"/>);
    expect(html).toContain('Não foi possível carregar');expect(html).not.toContain('Salvar conexão');
  });
});
