import { useEffect, useMemo } from 'react';
import { anyHeldWaiting, refreshHeld } from './feed-held';
import { useCoins } from './coins';
import { usePendingFeed } from './feed-pending';
import { activeNets, btcHistory, ethHistory, useAsync, useChainSettings } from './multichain';
import { solHistory, tronHistory } from './xchains';
import { btcItems, ethItems, mergeFeed, solItems, trxItems, type FeedItem } from './feed-core';

/** Recent payments on Bitcoin, Ethereum, Solana and Tron, for the networks switched on. One coin failing
 *  never hides the others. */
export function useOtherFeed() {
  useChainSettings();
  const coins = useCoins();
  const n = activeNets();
  const a = { btc: coins.btc.address, eth: coins.eth.address, sol: coins.sol.address, trx: coins.trx.address };
  const held = usePendingFeed();
  const waiting = held.some((x) => !x.time && !x.failed && (x.coin === 'eth' || x.coin === 'btc'));
  // ask the network about waiting payments every few seconds, so a landed one turns confirmed at once
  useEffect(() => {
    if (!waiting) return;
    const look = () => {
      if (anyHeldWaiting()) refreshHeld().catch(() => {});
    };
    look();
    const t = setInterval(look, 4000);
    return () => clearInterval(t);
  }, [waiting]);
  const r = useAsync(
    async () => {
      const ok = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
      const [b, e, s, t] = await Promise.all([
        a.btc ? ok(btcHistory(n.btc, a.btc).then((r) => btcItems(n.btc, r))) : [],
        a.eth ? ok(ethHistory(n.eth, a.eth).then((r) => ethItems(n.eth, r))) : [],
        a.sol ? ok(solHistory(n.sol, a.sol, 20).then((r) => solItems(n.sol, r))) : [],
        a.trx ? ok(tronHistory(n.trx, a.trx).then((r) => trxItems(n.trx, r))) : [],
      ]);
      return mergeFeed(b as FeedItem[], e as FeedItem[], s as FeedItem[], t as FeedItem[]);
    },
    [a.btc, a.eth, a.sol, a.trx, n.btc, n.eth, n.sol, n.trx],
    30_000,
  );
  const data = useMemo(() => (r.data ? mergeFeed(r.data, held) : held.length ? mergeFeed(held) : r.data), [r.data, held]);
  return { ...r, data };
}
