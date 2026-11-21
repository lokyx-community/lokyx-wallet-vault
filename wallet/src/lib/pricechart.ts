// A coin's price over a chosen stretch of time, from CoinGecko's free chart feed. The last answer is kept so the graph still draws offline.
import { getItem, setItem } from './kv';
import { fetchT } from './multichain';
import type { Currency } from './prices-core';

export type Span = '1D' | '1W' | '1M' | '1Y' | 'All';
export const SPANS: Span[] = ['1D', '1W', '1M', '1Y', 'All'];
const DAYS: Record<Span, string> = { '1D': '1', '1W': '7', '1M': '30', '1Y': '365', All: 'max' };

export const chartUrl = (id: string, cur: Currency, span: Span) =>
  `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${cur}&days=${DAYS[span]}`;

export type Point = [number, number]; // [unix ms, price]

/** Points oldest first, thinned to at most `max`. Anything unreadable is dropped. */
export function parseChart(json: unknown, max = 120): Point[] {
  const arr = (json as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(arr)) return [];
  const v = arr.map((p) => (Array.isArray(p) ? ([Number(p[0]), Number(p[1])] as Point) : ([NaN, NaN] as Point))).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] >= 0);
  if (v.length <= max) return v;
  const step = (v.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => v[Math.round(i * step)]);
}

export async function fetchChart(id: string, cur: Currency, span: Span): Promise<Point[]> {
  const key = `w.chart2.${id}.${cur}.${span}`;
  try {
    const r = await fetchT(chartUrl(id, cur, span), undefined, 12_000);
    if (!r.ok) throw new Error(String(r.status));
    const v = parseChart(await r.json());
    if (v.length > 1) {
      setItem(key, JSON.stringify(v)).catch(() => {});
      return v;
    }
  } catch {}
  try {
    const raw = await getItem(key);
    const v = raw ? (JSON.parse(raw) as Point[]) : [];
    if (Array.isArray(v) && v.length > 1) return v;
  } catch {}
  return [];
}
