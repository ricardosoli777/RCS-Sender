import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import MessagePreview from './preview';
describe('message content preview',() => {
  it('escapes content and opens valid HTTPS links without giving the destination access to the app',() => {
    const html = renderToStaticMarkup(<MessagePreview workspaceId="workspace" content={{ type: 'text',text: '<script>alert(1)</script>',suggestions: [{ type: 'open_url',text: 'Open',url: 'https://example.test' }] }} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://example.test/"'); expect(html).toContain('target="_blank"');expect(html).toContain('rel="noopener noreferrer"');
  });
  it('does not create clickable unsafe links, including unsaved editor content',()=>{
    for(const url of ['javascript:alert(1)','data:text/html,test','http://example.test','https://user:secret@example.test']){
      const html=renderToStaticMarkup(<MessagePreview workspaceId="workspace" content={{type:'text',text:'Hello',suggestions:[{type:'open_url',text:'Open',url}]}}/>);
      expect(html).not.toContain('href=');expect(html).toContain('disabled=""');
    }
  });
  it('renders clickable carousel actions and keeps reply routing payload private',()=>{
    const html=renderToStaticMarkup(<MessagePreview workspaceId="workspace" content={{type:'carousel',cards:[{title:'Card',body:'Body',suggestions:[{type:'open_url',text:'Offer',url:'https://example.test/offer'},{type:'reply',text:'Yes',payload:'private-routing-key'}]}]}}/>);
    expect(html).toContain('href="https://example.test/offer"');expect(html).toContain('<button');expect(html).not.toContain('private-routing-key');
  });
  it('loads rich-card images only through the authenticated workspace route',() => {
    const html = renderToStaticMarkup(<MessagePreview workspaceId="workspace-a" content={{ type: 'rich_card',card: { title: 'Title',body: 'Body',media: { assetId: 'asset-a',mimeType: 'image/png' },suggestions: [{ type: 'reply',text: 'Yes',payload: 'private-routing-key' }] } }} />);
    expect(html).toContain('/api/workspaces/workspace-a/media/asset-a/content');
    expect(html).toContain('Title'); expect(html).toContain('Resposta sugerida'); expect(html).not.toContain('private-routing-key');
  });
});
