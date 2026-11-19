// "Where should your savings live?" is asked once, right after a wallet is made or brought back on this phone.

import { getItem, removeItem, setItem } from './kv';
import { store, useStore } from './store';
import { resetHooks } from './wallet';

const KEY = 'w.vaultfirst';
export const vaultFirst = store<boolean>(false);
export const useVaultFirst = () => useStore(vaultFirst);

export async function loadVaultFirst() {
  vaultFirst.set((await getItem(KEY).catch(() => null)) === 'pending');
}
resetHooks.push(() => vaultFirst.set(false));

/** Call when a wallet has just been made or restored. */
export async function askVaultFirst() {
  vaultFirst.set(true);
  await setItem(KEY, 'pending');
}
export async function doneVaultFirst() {
  vaultFirst.set(false);
  await removeItem(KEY).catch(() => {});
}
