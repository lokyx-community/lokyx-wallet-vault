// Payments sent from this phone on Bitcoin, Ethereum, Solana or Tron show in Activity at once, as "Waiting",
// until the network's own history lists them (which can take a minute or more).

import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { resetHooks } from './wallet';
import type { FeedItem } from './feed-core';

const KEY = 'w.feedpending';
const DAY = 86400_000;
type Held = FeedItem & { at: number };
export const pendingFeed = store<Held[]>([]);
export const usePendingFeed = () => useStore(pendingFeed);

export async function loadPendingFeed() {
  try {
    pendingFeed.set((JSON.parse((await getItem(KEY)) ?? '[]') as Held[]).filter((x) => Date.now() - x.at < DAY));
  } catch {}
}
resetHooks.push(() => pendingFeed.set([]));

export async function notePendingFeed(item: FeedItem) {
  pendingFeed.set([{ ...item, time: 0, at: Date.now() }, ...pendingFeed.get().filter((x) => x.id !== item.id && Date.now() - x.at < DAY)].slice(0, 30));
  await setItem(KEY, JSON.stringify(pendingFeed.get()));
}
