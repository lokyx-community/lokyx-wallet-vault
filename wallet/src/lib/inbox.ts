// The notifications list: everything the wallet told you (a payment in, money leaving, a vault withdrawal
// waiting) kept in one place, newest first, with what you haven't looked at yet. Stored on the phone only.
// Written straight to storage (not only to memory) because the background service can run in its own process.

import { getItem, setItem } from './kv';
import { store, useStore } from './store';

export type InboxKind = 'receive' | 'send' | 'vault' | 'alert' | 'info';
export interface InboxItem {
  id: string;
  at: number;
  kind: InboxKind;
  title: string;
  body: string;
  /** Where tapping it goes. */
  route?: string;
  read: boolean;
}

const KEY = 'w.inbox';
const MAX = 200;
export const inbox = store<InboxItem[]>([]);
export const useInbox = () => useStore(inbox);
export const unreadCount = (l: InboxItem[]) => l.filter((i) => !i.read).length;

let chain: Promise<unknown> = Promise.resolve();
const queued = <T,>(f: () => Promise<T>): Promise<T> => {
  const r = chain.then(f, f);
  chain = r.catch(() => {});
  return r;
};

async function read(): Promise<InboxItem[]> {
  try {
    const l = JSON.parse((await getItem(KEY)) ?? '[]');
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}
const write = async (l: InboxItem[]) => {
  await setItem(KEY, JSON.stringify(l));
  inbox.set(l);
};

/** Load the saved list into memory (call when the app starts or the list is opened). */
export const loadInbox = () => queued(async () => void inbox.set(await read()));

/** Add one. The same `id` is never added twice. */
export const addInbox = (i: Omit<InboxItem, 'at' | 'read'> & { at?: number }) =>
  queued(async () => {
    const l = await read();
    if (l.some((x) => x.id === i.id)) return;
    await write([{ ...i, at: i.at ?? Date.now(), read: false }, ...l].sort((a, b) => b.at - a.at).slice(0, MAX));
  });

export const markAllRead = () =>
  queued(async () => {
    const l = await read();
    if (l.some((x) => !x.read)) await write(l.map((x) => ({ ...x, read: true })));
    else inbox.set(l);
  });

export const clearInbox = () => queued(() => write([]));
