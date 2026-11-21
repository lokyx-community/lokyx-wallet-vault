// Prices and the total. Prices come from CoinGecko's free feed; the last answer is kept so the total still shows offline.

import { useEffect, useMemo } from 'react';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { fetchMarket } from './market';
import { activeNets, useAsync, useChainSettings } from './multichain';
import { ETH_NETS, EVM_FAMILIES } from './multichain-core';
import { amountOf, marketsPath, parseMarkets, portfolio, PRICED, type Currency, type Holding, type Portfolio, type Quote } from './prices-core';
import type { Coins } from './coins';

const currencyStore = store<Currency>('usd');
let loaded = false;
async function loadCurrency() {
  if (loaded) return;
  loaded = true;
  try {
    const v = await getItem('w.currency');
    if (v === 'usd' || v === 'inr') currencyStore.set(v);
  } catch {}
}
export function useCurrency(): [Currency, (c: Currency) => void] {
  useEffect(() => {
    loadCurrency();
  }, []);
  return [useStore(currencyStore), (c) => { currencyStore.set(c); setItem('w.currency', c).catch(() => {}); }];
}

export async function fetchQuotes(ids: string[], cur: Currency): Promise<Record<string, Quote>> {
  const key = `w.prices.${cur}`;
  try {
    const r = await fetchMarket(marketsPath(ids, cur));
    if (!r.ok) throw new Error(String(r.status));
    const q = parseMarkets(await r.json());
    if (Object.keys(q).length) {
      setItem(key, JSON.stringify(q)).catch(() => {});
      return q;
    }
  } catch {}
  // offline, or the feed is busy: the last answer
  try {
    const raw = await getItem(key);
    if (raw) return parseMarkets(Object.entries(JSON.parse(raw) as Record<string, Quote>).map(([id, v]) => ({ id, current_price: v.price, price_change_percentage_24h: v.change24, sparkline_in_7d: { price: v.spark } })));
  } catch {}
  return {};
}

/** What the person holds on real-money networks. Test coins and LOKYX are not counted. */
export function holdingsOf(coins: Coins, allowMainnet: boolean, ethReal: boolean): Holding[] {
  const out: Holding[] = [];
  const add = (symbol: string, balance: string) => {
    const amount = amountOf(balance);
    if (amount > 0 && PRICED[symbol]) out.push({ symbol, amount });
  };
  if (coins.btc.tag === '') add('BTC', coins.btc.balance);
  if (allowMainnet) {
    add('ETH', coins.ethHome.balance);
    for (const e of coins.evm) add(EVM_FAMILIES[e.id].unit, e.balance);
  }
  if (ethReal) for (const t of coins.tokens) add(t.symbol, t.balance);
  for (const x of coins.extra) {
    if (coins[x].address && coins[x].tag === '') {
      add(coins[x].unit, coins[x].balance);
      for (const t of coins.xTokens[x]) add(t.symbol, t.balance);
    }
  }
  return out;
}

/** The total across the coins that have a market value, in the chosen currency. Empty when none do. */
export function usePortfolio(coins: Coins): { p: Portfolio | null; cur: Currency } {
  const [cur] = useCurrency();
  const cfg = useChainSettings();
  const ethReal = ETH_NETS[activeNets().eth].real;
  const holdings = useMemo(() => holdingsOf(coins, cfg.allowMainnet, ethReal), [coins, cfg.allowMainnet, ethReal]);
  const ids = [...new Set(holdings.map((h) => PRICED[h.symbol].id))].sort();
  const q = useAsync(async () => (ids.length ? fetchQuotes(ids, cur) : {}), [ids.join(','), cur], 120_000);
  const p = useMemo(() => {
    if (!holdings.length || !q.data) return null;
    const r = portfolio(holdings, q.data);
    return r.lines.length ? r : null;
  }, [holdings, q.data]);
  return { p, cur };
}
