// Two wallets on one phone: the real one, and the decoy that the decoy passcode opens.
// Everything the wallet stores under "w." is read from "d." instead while the decoy is open, so the decoy
// has its own words, accounts, people, history and caches, and nothing of the real wallet can show through.
// The decoy flag lives only in memory: a restart always comes back locked, to the real wallet.

import { store } from './store.ts';

export const decoyOpen = store(false);

/** Shared by both wallets: the passcodes, the phone's settings and network choices. */
const SHARED = new Set(['w.pin', 'w.genesis', 'w.decoy', 'w.settings', 'w.secmode', 'w.secface', 'w.node', 'w.nodes', 'w.chains']);

export function nsKey(key: string, decoy = decoyOpen.get()): string {
  if (!decoy || !key.startsWith('w.') || SHARED.has(key)) return key;
  return `d.${key.slice(2)}`;
}

/** Modules that keep wallet data in memory reload it here when the phone switches between the two wallets. */
export const switchHooks: (() => Promise<void> | void)[] = [];
export async function reloadForSwitch() {
  for (const f of switchHooks) {
    try {
      await f();
    } catch {
      /* one module failing to reload must not keep the others stale */
    }
  }
}
