import { switchHooks } from './ns';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { withNote, withTag, type TxMeta } from './txmeta-core';

const KEY = 'w.txmeta';
const all = store<Record<string, TxMeta>>({});
let loaded = false;
const read = async () => {
  try {
    const raw = await getItem(KEY);
    all.set(raw ? JSON.parse(raw) : {});
  } catch {
    all.set({});
  }
};
switchHooks.push(async () => {
  loaded = false;
  all.set({});
  await read();
  loaded = true;
});
export async function loadTxMeta() {
  if (loaded) return;
  loaded = true;
  await read();
}
const keep = (next: Record<string, TxMeta>) => {
  all.set(next);
  setItem(KEY, JSON.stringify(next)).catch(() => {});
};
/** Payment ids are kept lower-case so a hash matches however it was written. */
export const metaId = (id: string) => id.replace(/^0x/, '').toLowerCase();
export const useAllTxMeta = () => useStore(all);
export const setTxNote = (id: string, note: string) => keep(withNote(all.get(), metaId(id), note));
export const toggleTxTag = (id: string, tag: string) => keep(withTag(all.get(), metaId(id), tag));
