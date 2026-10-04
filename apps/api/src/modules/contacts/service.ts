import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { ContactInputError, type ContactInput, type ContactStore } from './contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';

export function normalizeContact(input: ContactInput) {
  const phone = input.phone.trim(); const name = (input.name ?? '').trim();
  if (phone.length > 64 || !/^\+?[0-9 () .-]+$/.test(phone) || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new ContactInputError();
  const parsed = parsePhoneNumberFromString(phone, { defaultCountry: 'BR', extract: false });
  if (!parsed?.isValid() || parsed.ext) throw new ContactInputError();
  return { phone: String(parsed.number), name };
}

// Bounded CSV parser: quoted delimiters/newlines and escaped quotes; never evaluates cells.
export function parseContactText(text: string): ContactInput[] {
  if (Buffer.byteLength(text) > 65536) throw new ContactInputError();
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0]!;
  let delimiter = ','; let inQuotes = false;
  for (let i = 0; i < first.length; i++) {
    const char = first[i]!;
    if (char === '"') { if (inQuotes && first[i + 1] === '"') i++; else inQuotes = !inQuotes; }
    else if (!inQuotes && [',', ';', '\t'].includes(char)) { delimiter = char; break; }
  }
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => { finishCell(); if (row.some((value) => value.trim())) rows.push(row); row = []; if (rows.length > 501) throw new ContactInputError(); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === '"') { if (cell || closed) throw new ContactInputError(); quoted = true; }
    else if (char === delimiter) finishCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    else { if (closed) throw new ContactInputError(); cell += char; }
  }
  if (quoted) throw new ContactInputError();
  finishRow();
  if (/^(phone|telefone)$/i.test(rows[0]?.[0]?.trim() ?? '')) {
    const header = rows.shift()!;
    if (header.length > 2 || (header[1] && !/^(name|nome)$/i.test(header[1].trim()))) throw new ContactInputError();
  }
  if (!rows.length || rows.length > 500 || rows.some((value) => value.length > 2)) throw new ContactInputError();
  return rows.map(([phone, name]) => ({ phone: phone!, name }));
}
export class ContactService {
  constructor(private readonly store: ContactStore) {}
  snapshot(context: WorkspaceContext, offset = 0) { return this.store.snapshot(context, offset); }
  import(context: WorkspaceContext, inputs: ContactInput[], listId?: string) {
    if (!inputs.length || inputs.length > 500) throw new ContactInputError();
    const invalidRows: number[] = []; const contacts: { phone: string; name: string }[] = [];
    inputs.forEach((input, index) => { try { contacts.push(normalizeContact(input)); } catch { invalidRows.push(index + 1); } });
    return this.store.import(context, contacts, invalidRows, listId);
  }
  createList(context: WorkspaceContext, name: string) {
    name = name.trim(); if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new ContactInputError();
    return this.store.createList(context, name);
  }
  deleteList(context: WorkspaceContext, id: string) { return this.store.deleteList(context, id); }
  setOptOut(context: WorkspaceContext, id: string) { return this.store.setOptOut(context, id); }
}
