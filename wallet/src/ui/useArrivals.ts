import { useEffect, useRef } from 'react';
import { flyCoin } from './CoinFlight';
import { success } from './controls';
import { toast } from './Toast';
import type { Coins } from '../lib/coins';
import { arrivals } from '../lib/arrivals-core';
import { ETH_NETS, EVM_FAMILIES, evmOf, formatUnits, type EthNet } from '../lib/multichain-core';
import { addInbox } from '../lib/inbox';

/** The coin for a balance on one Ethereum-style network: BNB for BNB Chain, Base for Base, and so on. */
function ethSpec(net: string, coins: Coins) {
  const n = net as EthNet;
  const fam = ETH_NETS[n] ? evmOf(n) : null;
  if (!ETH_NETS[n]) return { unit: coins.eth.unit, dec: 18, frac: 4, logo: coins.eth.logo };
  return { unit: ETH_NETS[n].unit, dec: 18, frac: 4, logo: fam ? EVM_FAMILIES[fam].logo : ('eth' as const) };
}

/**
 * Money that lands in any coin while the wallet is open: the coin falls in from the top, the way a LOKYX deposit does.
 * It notices a balance that went up, so it can be a few seconds late on coins that are checked every half minute.
 */
export function useArrivals(coins: Coins) {
  const before = useRef<Record<string, bigint> | null>(null);
  const key = Object.entries(coins.raw).map(([k, v]) => `${k}=${v}`).join('|');
  useEffect(() => {
    const now = coins.raw;
    if (!Object.keys(now).length) return;
    const found = arrivals(before.current, now);
    before.current = { ...(before.current ?? {}), ...now };
    if (!found.length) return;
    const a = found[0];
    const kind = a.key.split(':')[0];
    const tok = kind === 'erc20' ? coins.tokens.find((t) => t.contract.toLowerCase() === a.key.split(':')[2]) : undefined;
    const spec = kind === 'btc' ? { unit: coins.btc.unit, dec: 8, frac: 8, logo: 'btc' as const }
      : kind === 'eth' ? ethSpec(a.key.split(':')[1], coins)
      : kind === 'sol' ? { unit: 'SOL', dec: 9, frac: 4, logo: 'sol' as const }
      : kind === 'trx' ? { unit: 'TRX', dec: 6, frac: 2, logo: 'trx' as const }
      : tok ? { unit: tok.symbol, dec: tok.decimals, frac: 4, logo: tok.logo ?? 'eth' as const }
      : null;
    if (!spec) return;
    const text = `${formatUnits(a.delta, spec.dec, spec.frac)} ${spec.unit}`;
    success();
    flyCoin('in', spec.logo, found.length === 1 ? `+${text}` : undefined, tok && !tok.logo ? { symbol: tok.symbol, seed: tok.contract } : undefined);
    toast(found.length === 1 ? `Received ${text}` : `Received ${found.length} payments`, 'receive');
    addInbox({ id: `rx:${a.key}:${now[a.key]}`, kind: 'receive', title: `Received ${text}`, body: 'It arrived while the wallet was open.' });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
