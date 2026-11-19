// Prices and the total across coins. Pure functions (no network, no phone APIs), tested in test/prices.test.ts.
// Only coins on real-money networks are counted; test coins and LOKYX have no market value.

export type Currency = 'usd' | 'inr';

export interface PricedCoin {
  /** the id the price feed uses */
  id: string;
  name: string;
  logo?: 'btc' | 'eth' | 'sol' | 'trx' | 'usdt' | 'usdc' | 'pol' | 'bnb' | 'avax';
}

/** Coins the wallet can put a price on, by their symbol. */
export const PRICED: Record<string, PricedCoin> = {
  BTC: { id: 'bitcoin', name: 'Bitcoin', logo: 'btc' },
  ETH: { id: 'ethereum', name: 'Ethereum', logo: 'eth' },
  SOL: { id: 'solana', name: 'Solana', logo: 'sol' },
  TRX: { id: 'tron', name: 'Tron', logo: 'trx' },
  POL: { id: 'polygon-ecosystem-token', name: 'Polygon', logo: 'pol' },
  BNB: { id: 'binancecoin', name: 'BNB', logo: 'bnb' },
  AVAX: { id: 'avalanche-2', name: 'Avalanche', logo: 'avax' },
  USDT: { id: 'tether', name: 'Tether', logo: 'usdt' },
  USDC: { id: 'usd-coin', name: 'USD Coin', logo: 'usdc' },
  DAI: { id: 'dai', name: 'Dai' },
  WBTC: { id: 'wrapped-bitcoin', name: 'Wrapped Bitcoin' },
};

export interface Quote {
  price: number;
  /** percent change over the last 24 hours */
  change24: number;
  /** about a week of prices, oldest first */
  spark: number[];
}

export interface Holding {
  symbol: string;
  amount: number;
}

export interface Line {
  symbol: string;
  id: string;
  name: string;
  logo?: PricedCoin['logo'];
  amount: number;
  value: number;
  /** change in value over 24 hours, in the chosen currency */
  change: number;
  pct: number;
}

export interface Portfolio {
  total: number;
  change: number;
  pct: number;
  lines: Line[];
  /** the whole portfolio's value across the week, oldest first (empty when there is not enough to draw) */
  series: number[];
}

export const marketsUrl = (ids: string[], cur: Currency) =>
  `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${cur}&ids=${[...new Set(ids)].sort().join(',')}&sparkline=true&price_change_percentage=24h&per_page=250`;

/** The price feed's answer, as quotes by coin id. Anything that does not look right is left out. */
export function parseMarkets(json: unknown): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  if (!Array.isArray(json)) return out;
  for (const r of json) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const price = Number(o.current_price);
    if (typeof o.id !== 'string' || !Number.isFinite(price) || price < 0) continue;
    const ch = Number(o.price_change_percentage_24h);
    const sp = (o.sparkline_in_7d as { price?: unknown } | undefined)?.price;
    out[o.id] = { price, change24: Number.isFinite(ch) ? ch : 0, spark: Array.isArray(sp) ? sp.map(Number).filter((n) => Number.isFinite(n)) : [] };
  }
  return out;
}

/** A shown balance ("1,204.5", "0.0062") as a number; empty or unreadable is 0. */
export function amountOf(s: string): number {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function portfolio(holdings: Holding[], quotes: Record<string, Quote>): Portfolio {
  const bySymbol = new Map<string, number>();
  for (const h of holdings) if (h.amount > 0 && PRICED[h.symbol]) bySymbol.set(h.symbol, (bySymbol.get(h.symbol) ?? 0) + h.amount);
  const lines: Line[] = [];
  const parts: { amount: number; spark: number[] }[] = [];
  for (const [symbol, amount] of bySymbol) {
    const meta = PRICED[symbol];
    const q = quotes[meta.id];
    if (!q) continue;
    const value = amount * q.price;
    const before = value / (1 + q.change24 / 100);
    lines.push({ symbol, id: meta.id, name: meta.name, logo: meta.logo, amount, value, change: value - before, pct: q.change24 });
    parts.push({ amount, spark: q.spark });
  }
  lines.sort((a, b) => b.value - a.value);
  const total = lines.reduce((s, l) => s + l.value, 0);
  const change = lines.reduce((s, l) => s + l.change, 0);
  const prior = total - change;
  const n = parts.length && parts.every((p) => p.spark.length > 1) ? Math.min(...parts.map((p) => p.spark.length)) : 0;
  const series: number[] = [];
  for (let i = 0; i < n; i++) series.push(parts.reduce((s, p) => s + p.amount * p.spark[p.spark.length - n + i], 0));
  return { total, change, pct: prior > 0 ? (change / prior) * 100 : 0, lines, series };
}

const group = (int: string, indian: boolean) => {
  if (!indian || int.length <= 3) return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + int.slice(-3);
};

/** "$ 1,248.60" or "₹ 1,04,300.00". Small amounts keep their cents; large ones drop them. */
export function money(n: number, cur: Currency): string {
  const neg = n < 0;
  const a = Math.abs(n);
  const [i, d] = (a >= 100_000 ? a.toFixed(0) : a.toFixed(2)).split('.');
  return `${neg ? '−' : ''}${cur === 'inr' ? '₹' : '$'} ${group(i, cur === 'inr')}${d ? '.' + d : ''}`;
}

/** "▲ $ 38.20 · 3.1% today", or "▼" when down. */
export function changeText(change: number, pct: number, cur: Currency): string {
  const up = change >= 0;
  return `${up ? '▲' : '▼'} ${money(Math.abs(change), cur)} · ${Math.abs(pct).toFixed(1)}% today`;
}
