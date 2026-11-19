import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { switchHooks } from './ns';
import { isAddress } from './lokyx';
import { activeNets } from './multichain';
import { btcAddressOk, ethAddressOk } from './multichain-core';
import { addWatch, parseWatched, removeWatch, type WatchChain, type Watched } from './watchonly-core';

const KEY = 'w.watch';
export const watched = store<Watched[]>([]);
export const useWatched = () => useStore(watched);

export async function loadWatched() {
  watched.set(parseWatched(await getItem(KEY)));
}
switchHooks.push(loadWatched);

const save = async (l: Watched[]) => {
  watched.set(l);
  await setItem(KEY, JSON.stringify(l));
};

export async function watchAddress(chain: WatchChain, address: string, name: string) {
  const a = address.trim();
  const ok = chain === 'lyx' ? isAddress(a) : chain === 'btc' ? btcAddressOk(a, activeNets().btc) : ethAddressOk(a);
  if (!ok) throw new Error(`That isn't a ${chain === 'lyx' ? 'LOKYX' : chain === 'btc' ? 'Bitcoin' : 'Ethereum'} address for the network you're on`);
  await save(addWatch(watched.get(), { chain, address: a, name: name.trim() || 'Watching' }));
}

export const unwatch = (id: string) => save(removeWatch(watched.get(), id));
