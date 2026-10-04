import { describe,expect,it } from 'vitest';
import { contentOf,draftIssues,providerIssues,toDraft,type ProviderOption } from './editor-model';
import type { MessageVersion } from './types';
const version: MessageVersion = { id: 'version',message_id: 'message',version: 4,name: 'Card',purpose: 'transactional',content: {
  type: 'rich_card',card: { title: 'Title',body: 'Body',media: { assetId: 'asset',mimeType: 'image/png' },suggestions: [{ type: 'reply',text: 'Yes',payload: 'branch_yes' }] },suggestions: [{ type: 'open_url',text: 'Open',url: 'https://example.test' }]
} };
describe('message builder snapshot handling',() => {
  it('preserves versioned categories and image file drafts without declaring provider support',()=>{
    const draft=toDraft({...version,archetype:'reminder',content:{type:'file',media:{assetId:'asset',mimeType:'image/png'}}});expect(draft.archetype).toBe('reminder');expect(contentOf(draft)).toMatchObject({type:'file',media:{assetId:'asset'}});
    expect(providerIssues(draft,{id:'fixture',name:'Fixture',active:true,capabilities:{file:'unsupported'},limits:{}})).toContain('Arquivo: não suportado.');
  });
  it('preserves carousel snapshots including per-card actions and checks standalone media',()=>{
    const content={type:'carousel' as const,cards:[{title:'One',body:'First',suggestions:[{type:'reply' as const,text:'Yes',payload:'yes'}]},{title:'Two',body:'Second'}],suggestions:[]};
    const draft=toDraft({...version,content}); expect(contentOf(draft)).toEqual(content); expect(draftIssues(draft)).toEqual([]);
    draft.cards![0]!.title='Changed';expect(content.cards[0]!.title).toBe('One');
    draft.format='media';draft.media=undefined;expect(draftIssues(draft)).toContain('Escolha uma imagem.');
  });
  it('preserves card/root suggestion placement, media and purpose when editing',() => {
    const draft = toDraft(version); expect(contentOf(draft)).toEqual(version.content); expect(draft.purpose).toBe('transactional');
    draft.media!.assetId = 'changed'; draft.suggestions[0]!.value = 'https://changed.test';
    expect(version.content).toMatchObject({ card: { media: { assetId: 'asset' } },suggestions: [{ url: 'https://example.test' }] });
  });
  it('moves all suggestions into text content without leaking a hidden image or title',() => {
    const draft = toDraft(version); draft.format = 'text';
    expect(contentOf(draft)).toEqual({ type: 'text',text: 'Body',suggestions: [{ type: 'open_url',text: 'Open',url: 'https://example.test' },{ type: 'reply',text: 'Yes',payload: 'branch_yes' }] });
  });
  it('validates code points, URLs and the complete JSON byte budget',() => {
    const draft = toDraft(version); draft.body = '👋'.repeat(10000); expect(draftIssues(draft,4)).toEqual([]);
    draft.body += '👋'; expect(draftIssues(draft,4).join()).toContain('Texto');
    draft.body = '\n'.repeat(9000)+'a'; draft.suggestions[0]!.value = 'https://user:password@example.test'; expect(draftIssues(draft).join()).toContain('HTTPS');
    draft.body = '\u0000'.repeat(10000); draft.suggestions[0]!.value = 'https://example.test';
    draft.suggestions = Array.from({ length: 10 },() => ({ type: 'open_url',text: 'x'.repeat(100),value: `https://example.test/${'x'.repeat(2000)}`,placement: 'card' }));
    expect(draftIssues(draft,4).join()).toContain('64 KiB');
  });
  it('keeps unknown/unsupported capabilities distinct and checks the combined suggestion limit',() => {
    const draft = toDraft(version); const provider: ProviderOption = { id: 'fixture',name: 'Fixture',active: false,capabilities: { rich_card: 'supported',media: 'unknown',url_actions: 'unsupported',suggested_replies: 'supported' },limits: { maxSuggestions: 1,maxTitleCharacters: 2,maxTextCharacters: 2 } };
    expect(providerIssues(draft,provider)).toEqual(expect.arrayContaining(['Adaptador inativo.','Mídia: suporte desconhecido.','Ações de URL: não suportado.','Sugestões excedem o limite 1 do adaptador.']));
    expect(providerIssues(draft,provider).join()).toContain('Título excede'); expect(providerIssues(draft,provider).join()).toContain('Texto excede');
  });
});
