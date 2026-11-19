// One list of everything that happened, from every coin. Pure functions, tested in test/feed.test.ts.

import { ETH_NETS, formatBtc, formatUnits, BTC_NETS, type BtcNet, type EthNet, type EthTxRow } from './multichain-core.ts';
import { SOL_DECIMALS, SOL_NETS, type SolNet, type SolTxRow } from './sol-core.ts';
import { TRON_NETS, TRX_DECIMALS, type TronNet, type TronTxRow } from './tron-core.ts';

export type FeedCoin = 'lyx' | 'btc' | 'eth' | 'sol' | 'trx';
export const FEED_COINS: { id: FeedCoin; name: string }[] = [
  { id: 'lyx', name: 'LOKYX' },
  { id: 'btc', name: 'Bitcoin' },
  { id: 'eth', name: 'Ethereum' },
  { id: 'sol', name: 'Solana' },
  { id: 'trx', name: 'Tron' },
];
export type FeedKind = 'sent' | 'received' | 'mined' | 'self';

export interface FeedItem {
  id: string;
  coin: FeedCoin;
  kind: FeedKind;
  /** unix seconds; 0 while it is still waiting for a block */
  time: number;
  /** the amount without a sign, and the unit, e.g. "0.025" "sBTC" */
  amount: string;
  unit: string;
  failed: boolean;
  /** where to read it: a page on the coin's explorer (not for LOKYX, which has its own screens) */
  url?: string;
  /** the person or address on the other side, when known */
  other?: string;
  /** the network it happened on, for the small label */
  net: string;
}

const abs = (n: bigint) => (n < 0n ? -n : n);
const kindOf = (d: bigint): FeedKind => (d < 0n ? 'sent' : 'received');

export function btcItems(net: BtcNet, rows: { txid: string; confirmed: boolean; time?: number; delta: bigint }[]): FeedItem[] {
  return rows.map((r) => ({
    id: `btc:${r.txid}`,
    coin: 'btc',
    kind: r.delta === 0n ? 'self' : kindOf(r.delta),
    time: r.time ?? 0,
    amount: formatBtc(abs(r.delta)),
    unit: BTC_NETS[net].unit,
    failed: false,
    url: `${BTC_NETS[net].esplora.replace(/\/api$/, '')}/tx/${r.txid}`,
    net: BTC_NETS[net].label.replace('Bitcoin ', ''),
  }));
}

export function ethItems(net: EthNet, rows: EthTxRow[]): FeedItem[] {
  return rows.map((r) => ({
    id: `eth:${net}:${r.hash}`,
    coin: 'eth',
    kind: r.delta === 0n ? 'self' : kindOf(r.delta),
    time: r.time,
    amount: formatUnits(abs(r.delta), r.decimals, 6),
    unit: r.symbol || ETH_NETS[net].unit,
    failed: r.failed,
    url: `${ETH_NETS[net].explorer}/tx/${r.hash}`,
    net: ETH_NETS[net].short,
  }));
}

export function solItems(net: SolNet, rows: SolTxRow[]): FeedItem[] {
  return rows.map((r) => ({
    id: `sol:${r.id}`,
    coin: 'sol',
    kind: kindOf(r.delta),
    time: r.time ?? 0,
    amount: formatUnits(abs(r.delta), SOL_DECIMALS, 5),
    unit: 'SOL',
    failed: r.failed,
    url: SOL_NETS[net].explorer('tx', r.id),
    net: SOL_NETS[net].short,
  }));
}

export function trxItems(net: TronNet, rows: TronTxRow[]): FeedItem[] {
  return rows.map((r) => ({
    id: `trx:${r.id}`,
    coin: 'trx',
    kind: kindOf(r.delta),
    time: r.time ?? 0,
    amount: formatUnits(abs(r.delta), TRX_DECIMALS, 4),
    unit: 'TRX',
    failed: r.failed,
    url: `${TRON_NETS[net].explorer}/transaction/${r.id}`,
    other: r.other,
    net: TRON_NETS[net].short,
  }));
}

/** Newest first; items still waiting for a block (time 0) come first. Same id twice keeps one. */
export function mergeFeed(...lists: FeedItem[][]): FeedItem[] {
  const seen = new Set<string>();
  const all: FeedItem[] = [];
  for (const l of lists)
    for (const x of l) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      all.push(x);
    }
  return all.sort((a, b) => (b.time || Infinity) - (a.time || Infinity));
}

export type KindFilter = 'all' | 'sent' | 'received' | 'mined';

export function filterFeed(items: FeedItem[], coin: FeedCoin | 'all', kind: KindFilter): FeedItem[] {
  return items.filter((i) => (coin === 'all' || i.coin === coin) && (kind === 'all' || (kind === 'sent' ? i.kind === 'sent' || i.kind === 'self' : i.kind === kind)));
}
