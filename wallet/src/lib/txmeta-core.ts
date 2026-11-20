// Your own notes and tags on payments. Kept on this phone only; nothing here is sent anywhere. Pure functions, tested in test/txmeta.test.ts.

export interface TxMeta {
  note?: string;
  tags?: string[];
}
export const TAGS = ['Gift', 'Family', 'Rent', 'Food', 'Work', 'Bills'];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 80);

/** Set the note; an empty note removes it, and an entry with nothing left is dropped. */
export function withNote(all: Record<string, TxMeta>, id: string, note: string): Record<string, TxMeta> {
  const next = { ...all };
  const m: TxMeta = { ...next[id], note: clean(note) || undefined };
  if (!m.note && !m.tags?.length) delete next[id];
  else next[id] = m;
  return next;
}

/** Add the tag, or take it off when it is already there. One tag at a time is plenty. */
export function withTag(all: Record<string, TxMeta>, id: string, tag: string): Record<string, TxMeta> {
  const next = { ...all };
  const has = next[id]?.tags?.includes(tag);
  const m: TxMeta = { ...next[id], tags: has ? [] : [tag] };
  if (!m.note && !m.tags?.length) delete next[id];
  else next[id] = m;
  return next;
}

/** Does a payment match what was typed? Every word has to appear somewhere in the text it is checked against. */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
