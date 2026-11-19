// Watch-only: follow an address without holding its key. Nothing here can spend.

export type WatchChain = 'lyx' | 'btc' | 'eth';
export type Watched = { id: string; name: string; chain: WatchChain; address: string };

export const watchId = (chain: WatchChain, address: string) => `${chain}:${chain === 'eth' ? address.toLowerCase() : address}`;

/** Adds one, refusing duplicates. */
export function addWatch(list: Watched[], w: Omit<Watched, 'id'>): Watched[] {
  const id = watchId(w.chain, w.address);
  if (list.some((x) => x.id === id)) throw new Error('You are already watching that address');
  return [...list, { ...w, id }];
}

export const removeWatch = (list: Watched[], id: string): Watched[] => list.filter((x) => x.id !== id);

export function parseWatched(raw: string | null): Watched[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.address === 'string' && ['lyx', 'btc', 'eth'].includes(x.chain)) : [];
  } catch {
    return [];
  }
}
