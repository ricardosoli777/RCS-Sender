import { describe,expect,it } from 'vitest';
import type { MessageInput } from './contracts.js';
import { validateMessageInput } from './validation.js';
const input: MessageInput = { name: ' Welcome ',purpose: 'marketing',content: { type: 'text',text: 'Olá 👋' } };
describe('message validation',() => {
  it('normalizes names and returns an independent snapshot',() => {
    const saved = validateMessageInput(input); expect(saved.name).toBe('Welcome');
    expect(saved.content).toEqual(input.content); expect(saved.content).not.toBe(input.content);
  });
  it('rejects blank bodies, unknown fields, control characters and unsupported formats',() => {
    for (const content of [{ type: 'text',text: '  ' },{ type: 'text',text: 'hi',secret: true },{ type: 'text',text: '\u0000' },{ type: 'carousel',cards: [] }]) {
      expect(() => validateMessageInput({ ...input,content } as MessageInput)).toThrow();
    }
  });
  it('bounds Unicode text and total suggestions',() => {
    expect(() => validateMessageInput({ ...input,content: { type: 'text',text: '👋'.repeat(10000) } })).not.toThrow();
    expect(() => validateMessageInput({ ...input,content: { type: 'text',text: 'a'.repeat(10001) } })).toThrow();
    const replies = Array.from({ length: 6 },() => ({ type: 'reply' as const,text: 'Sim',payload: 'yes' }));
    expect(() => validateMessageInput({ ...input,content: { type: 'rich_card',suggestions: replies,card: { title: 'A',body: 'B',suggestions: replies } } })).toThrow();
  });
  it('permits HTTPS links and rejects credentials, local schemes and malformed media',() => {
    for (const url of ['http://example.test','https://user:password@example.test','javascript:alert(1)','https://example.test/\n']) {
      expect(() => validateMessageInput({ ...input,content: { type: 'text',text: 'hi',suggestions: [{ type: 'open_url',text: 'Open',url }] } })).toThrow();
    }
    expect(() => validateMessageInput({ ...input,content: { type: 'text',text: 'hi',suggestions: [{ type: 'open_url',text: 'Open',url: 'https://example.test/a' }] } })).not.toThrow();
    expect(() => validateMessageInput({ ...input,content: { type: 'rich_card',card: { title: 'A',body: 'B',media: null } } } as unknown as MessageInput)).toThrow();
  });
});
