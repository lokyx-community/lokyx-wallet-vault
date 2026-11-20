import { useEffect } from 'react';
import { switchHooks } from './ns';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { fetchQuotes, useCurrency } from './prices';
import { PRICED, type Currency } from './prices-core';
import { metaId } from './txmeta';
import { shouldRecord, type WorthMap } from './worth-core';
import { chainSettings, useAsync } from './multichain';
import type { FeedItem } from './feed-core';

const KEY = 'w.worth';
const all = store<WorthMap>({});
let loaded = false;
const read = async () => {
  try {
    const raw = await getItem(KEY);
    all.set(raw ? JSON.parse(raw) : {});
  } catch {
    all.set({});
  }
};
switchHooks.push(async () => { loaded = false; all.set({}); await read(); loaded = true; });
export async function loadWorth() {
  if (loaded) return;
  loaded = true;
  await read();
}
export const useWorth = () => useStore(all);

/** Priced coins on real-money networks only; test coins and LOKYX have no market value. */
export const pricedSymbol = (item: Pick<FeedItem, 'coin' | 'unit'>): string | undefined =>
  chainSettings.get().allowMainnet && item.coin !== 'lyx' && PRICED[item.unit] ? item.unit : undefined;

/** Write down today's price for payments that are new to this phone. Safe to call often. */
export async function recordWorth(items: FeedItem[], cur: Currency) {
  await loadWorth();
  const now = Math.floor(Date.now() / 1000);
  const map = all.get();
  const todo = items.filter((i) => pricedSymbol(i) && shouldRecord(map, metaId(i.id.split(':').pop() ?? ''), i.time, now));
  if (!todo.length) return;
  const quotes = await fetchQuotes([...new Set(todo.map((i) => PRICED[i.unit].id))], cur);
  const next = { ...all.get() };
  let changed = false;
  for (const i of todo) {
    const q = quotes[PRICED[i.unit].id];
    const id = metaId(i.id.split(':').pop() ?? '');
    if (q && q.price > 0 && !next[id]) { next[id] = { p: q.price, c: cur }; changed = true; }
  }
  if (changed) {
    all.set(next);
    setItem(KEY, JSON.stringify(next)).catch(() => {});
  }
}

/** One coin's price right now, refreshed every two minutes. */
export function useNowPrice(symbol: string | undefined) {
  const [cur] = useCurrency();
  useEffect(() => { loadWorth(); }, []);
  const q = useAsync(async () => (symbol ? fetchQuotes([PRICED[symbol].id], cur) : {}), [symbol, cur], 120_000);
  return { price: symbol ? q.data?.[PRICED[symbol].id]?.price : undefined, cur };
}
