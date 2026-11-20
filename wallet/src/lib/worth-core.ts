// What a payment was worth when this phone first saw it, and what you spent this month. Pure functions, tested in test/worth.test.ts.
// The price is written down the first time a recent payment shows up. Older payments have no price then and are never guessed.

import type { Currency } from './prices-core.ts';

export interface WorthRec {
  /** price of one coin, in `c`, when the payment was first seen */
  p: number;
  c: Currency;
}
export type WorthMap = Record<string, WorthRec>;

/** A payment gets its price written down only while it is new: still waiting, or less than 20 minutes old. */
export const FRESH = 20 * 60;
export const shouldRecord = (map: WorthMap, id: string, time: number, now: number) => !map[id] && (!time || now - time <= FRESH);

export function thenNow(amount: number, rec: WorthRec | undefined, nowPrice: number | undefined, cur: Currency): { then: number; now: number; pct: number } | null {
  if (!rec || rec.c !== cur || !nowPrice || !(amount > 0)) return null;
  const then = amount * rec.p;
  const now = amount * nowPrice;
  return { then, now, pct: then > 0 ? ((now - then) / then) * 100 : 0 };
}

export interface SpendRow {
  id: string;
  time: number;
  amount: number;
  kind: 'sent' | 'received' | 'self' | 'mined';
  /** the coin's symbol, only for coins that have a market price */
  symbol?: string;
}

/** Spent and received since the start of this month (local time), with how many payments had no price and were left out. */
export function monthTotals(rows: SpendRow[], map: WorthMap, cur: Currency, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  let spent = 0, got = 0, sentN = 0, gotN = 0, unpriced = 0;
  for (const r of rows) {
    if (!r.symbol || r.time < start || (r.kind !== 'sent' && r.kind !== 'received')) continue;
    const rec = map[r.id];
    if (!rec || rec.c !== cur) { unpriced++; continue; }
    const v = r.amount * rec.p;
    if (r.kind === 'sent') { spent += v; sentN++; } else { got += v; gotN++; }
  }
  return { spent, got, sentN, gotN, unpriced };
}
