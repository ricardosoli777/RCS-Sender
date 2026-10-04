import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import MessagePreview from './preview';
describe('message content preview',() => {
  it('escapes content and keeps suggested links inert',() => {
    const html = renderToStaticMarkup(<MessagePreview workspaceId="workspace" content={{ type: 'text',text: '<script>alert(1)</script>',suggestions: [{ type: 'open_url',text: 'Open',url: 'https://example.test' }] }} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('https://example.test'); expect(html).not.toContain('href=');
  });
  it('loads rich-card images only through the authenticated workspace route',() => {
    const html = renderToStaticMarkup(<MessagePreview workspaceId="workspace-a" content={{ type: 'rich_card',card: { title: 'Title',body: 'Body',media: { assetId: 'asset-a',mimeType: 'image/png' },suggestions: [{ type: 'reply',text: 'Yes',payload: 'private-routing-key' }] } }} />);
    expect(html).toContain('/api/workspaces/workspace-a/media/asset-a/content');
    expect(html).toContain('Title'); expect(html).toContain('Resposta sugerida'); expect(html).not.toContain('private-routing-key');
  });
});
