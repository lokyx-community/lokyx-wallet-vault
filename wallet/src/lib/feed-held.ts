// A payment sent from this phone shows as "waiting" until the network says it is in a block. Do not wait for the
// slow history list to say so: ask the network itself every few seconds, and update the row at once.

import { activeNets, btcTxMore, ethTxMore } from './multichain';
import { pendingFeed, saveHeld } from './feed-pending';
import { landed } from './feed-core';
import type { EthNet } from './multichain-core';

/** True while any held payment is still waiting for a block. */
export const anyHeldWaiting = () => pendingFeed.get().some((x) => !x.time && !x.failed && (x.coin === 'eth' || x.coin === 'btc'));

/** One look at every waiting payment; rows that have landed get their block time. Returns whether any still wait. */
export async function refreshHeld(): Promise<boolean> {
  const list = pendingFeed.get();
  let changed = false;
  const next = await Promise.all(
    list.map(async (x) => {
      if (x.time || x.failed) return x;
      try {
        const [, a, b] = x.id.split(':');
        const more = x.coin === 'eth' ? await ethTxMore(a as EthNet, b) : x.coin === 'btc' ? await btcTxMore(activeNets().btc, a) : undefined;
        if (!more) return x;
        const l = landed(x, more);
        if (l !== x) changed = true;
        return l === x ? x : { ...x, ...l };
      } catch {
        return x;
      }
    }),
  );
  if (changed) {
    pendingFeed.set(next);
    await saveHeld();
  }
  return next.some((x) => !x.time && !x.failed && (x.coin === 'eth' || x.coin === 'btc'));
}
