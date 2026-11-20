// What the market screens need beyond predict-core: reading a typed share count, the numbers on the buy/sell sheet,
// the words on cards and the receipt. Pure, so it is tested here; the screens only draw it.

import { amountText, bestAsk, bestBid, payoff, quote, type Ladder, type MarketState, type Outcome, type Payoff, type Quote, type Side, type Stage } from './predict-core.ts';

export const MAX_SHARES = 10_000n;

/** A share count typed by a person: whole numbers only, 1 up to MAX_SHARES. Anything else is null. */
export function parseQty(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d{1,5}$/.test(t)) return null;
  const n = BigInt(t);
  return n >= 1n && n <= MAX_SHARES ? n : null;
}

export interface TradeView {
  /** the order as it will be sent, or null while something is missing */
  q: Quote | null;
  pay: Payoff | null;
  /** why the slide is off, in a plain sentence; null when it can go */
  why: string | null;
  /** coins to add to the market balance first (buys only), 0 when there is enough */
  short: bigint;
}

/**
 * The buy/sell sheet's numbers. `limit` is the most you pay per share (buy) or the least you accept (sell), in cents of
 * the outcome. `free` is the coins you have in the market; `have` the shares of this outcome you hold.
 */
export function tradeView(a: { ladder: Ladder; outcome: Outcome; side: Side; limit: number; qty: bigint | null; unit: bigint; feeBps: number; free: bigint; have: bigint }): TradeView {
  if (a.qty === null) return { q: null, pay: null, why: 'Choose how many shares', short: 0n };
  if (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > 99) return { q: null, pay: null, why: 'The price must be between 1¢ and 99¢', short: 0n };
  const q = quote(a.ladder, a.outcome, a.side, a.limit, a.qty, a.unit, a.feeBps);
  if (a.side === 'sell') {
    if (a.have < a.qty) return { q, pay: null, why: `You hold ${a.have} ${a.outcome === 'yes' ? 'Yes' : 'No'} share${a.have === 1n ? '' : 's'}`, short: 0n };
    return { q, pay: null, why: null, short: 0n };
  }
  const short = q.total > a.free ? q.total - a.free : 0n;
  // what you pay for the shares that trade now and the ones that wait, plus the fee, against what the shares can win
  const pay = payoff(q.tradeValue + q.locked + q.fee, a.qty, a.unit);
  return { q, pay, why: short > 0n ? 'Not enough in your market balance' : null, short };
}

/** The price to start from: what it costs to take the cheapest offer right now, else a middling guess near the last. */
export function startPrice(l: Ladder, outcome: Outcome, side: Side, fallback: number | null): number {
  const yesAsk = bestAsk(l);
  const yesBid = bestBid(l);
  let p: number | null;
  if (side === 'buy') p = outcome === 'yes' ? yesAsk : yesBid === null ? null : 100 - yesBid;
  else p = outcome === 'yes' ? yesBid : yesAsk === null ? null : 100 - yesAsk;
  const v = p ?? (fallback !== null ? (outcome === 'yes' ? fallback : 100 - fallback) : 50);
  return Math.min(99, Math.max(1, Math.round(v)));
}

/** One short line for a market card or header: where it is in its life. */
export function stageLabel(stage: Stage, state: MarketState, closes: string): string {
  switch (stage) {
    case 'trading': return closes;
    case 'needs-answer': return 'Waiting for an answer';
    case 'answer-waiting': return 'Answer proposed';
    case 'disputed': return 'Answer disputed';
    case 'expired': return 'Expired';
    case 'decided': return state === 'yes' ? 'Decided: Yes' : state === 'no' ? 'Decided: No' : 'Decided: Invalid';
  }
}

export interface ReceiptFacts {
  verb: string;
  headline: string;
  detail: string;
}

/**
 * What to tell the person after an order is mined. `fills` are the matches that happened; if none, the order is
 * waiting in the book at `limit`.
 */
export function receiptFacts(a: { outcome: Outcome; side: Side; qty: bigint; limit: number; fills: { yesPrice: number; qty: bigint }[]; ok: boolean; unit: bigint; decimals: number }): ReceiptFacts {
  const word = a.outcome === 'yes' ? 'Yes' : 'No';
  const verb = a.side === 'buy' ? 'Bought' : 'Sold';
  if (!a.ok) return { verb: 'Not done', headline: 'The order did not go through', detail: 'Nothing was taken from your balance.' };
  const own = (yp: number) => (a.outcome === 'yes' ? yp : 100 - yp);
  const got = a.fills.reduce((s, f) => s + f.qty, 0n);
  if (got === 0n) return { verb: 'Placed', headline: `Order placed at ${a.limit}¢`, detail: `${a.qty} ${word} share${a.qty === 1n ? '' : 's'} wait in the book until someone takes them.` };
  const cost = a.fills.reduce((s, f) => s + BigInt(own(f.yesPrice)) * f.qty, 0n);
  const avg = Number((cost * 100n) / got) / 100;
  const rest = a.qty - got;
  const head = `${verb} ${got} ${word} share${got === 1n ? '' : 's'} at ${avg}¢ each`;
  return { verb, headline: head, detail: rest > 0n ? `${rest} more wait in the book at ${a.limit}¢.` : `Each share pays ${amountText(a.unit, a.decimals, 2)} if ${word} wins.` };
}

// ---------- making a market ----------

export const CLOSE_CHOICES: [string, number][] = [['2 hours', 7_200], ['1 day', 86_400], ['3 days', 259_200], ['1 week', 604_800]];
export const MAX_TITLE_CHARS = 200;

export interface PanelCheck {
  list: string[];
  why: string | null;
}

/** One address per line (or separated by spaces or commas): 3 to 9 different, well-formed addresses. */
export function parsePanel(text: string): PanelCheck {
  const list = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const bad = list.find((a) => !/^0x[0-9a-fA-F]{40}$/.test(a));
  if (bad) return { list, why: `“${bad.length > 14 ? bad.slice(0, 10) + '…' : bad}” is not an address` };
  const seen = new Set<string>();
  for (const a of list) {
    const k = a.toLowerCase();
    if (seen.has(k)) return { list, why: 'An address is listed twice' };
    seen.add(k);
  }
  if (list.length < 3) return { list, why: `Add at least 3 people (you have ${list.length})` };
  if (list.length > 9) return { list, why: `No more than 9 people (you have ${list.length})` };
  return { list, why: null };
}

/** Whether the form can be sent, and the first thing missing. */
export function marketForm(a: { title: string; panel: string }): { why: string | null; panel: string[] } {
  const t = a.title.trim();
  const p = parsePanel(a.panel);
  if (!t) return { why: 'Write the question', panel: p.list };
  if (t.length > MAX_TITLE_CHARS) return { why: `Keep the question under ${MAX_TITLE_CHARS} characters`, panel: p.list };
  return { why: p.why, panel: p.list };
}
