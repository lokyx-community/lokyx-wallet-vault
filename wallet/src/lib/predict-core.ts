// Prediction markets: the rules the screens need, as plain functions. No phone APIs and no network, so every line can be
// tested. The contract is the source of truth (PredictionMarket.sol); everything here only shows what it will do.
//
// Prices are whole cents, 1 to 99, always "per share, in the terms of the outcome you name". A share of the winning
// side pays one `unit` (a multiple of 100 base units), so one cent is unit / 100 base units.

export const BOND_SHARES = 20n;
/** After an answer is proposed, anyone can object for this long (seconds). */
export const WINDOW_SECS = 86_400;
/** With no answer, or a stuck dispute, anyone can close the market as Invalid after this long (seconds). */
export const EXPIRE_SECS = 2_592_000;
export const MAX_ORDERS = 100;

export type Outcome = 'yes' | 'no';
export type Side = 'buy' | 'sell';

/** One waiting order as the contract's `book()` returns it: in its own outcome's terms. */
export interface BookOrder {
  id: bigint;
  owner: string;
  outcome: Outcome;
  side: Side;
  price: number;
  qty: bigint;
}

/** The raw arrays `book(id)` returns. */
export interface RawBook {
  ids: bigint[];
  owners: string[];
  outcomes: number[];
  sides: number[];
  prices: number[];
  qtys: bigint[];
}

export function parseBook(raw: RawBook): BookOrder[] {
  return raw.ids.map((id, i) => ({
    id,
    owner: raw.owners[i],
    outcome: raw.outcomes[i] === 1 ? 'no' : 'yes',
    side: raw.sides[i] === 1 ? 'sell' : 'buy',
    price: raw.prices[i],
    qty: raw.qtys[i],
  }));
}

/** An order's place on the one shared ladder of Yes prices: buying Yes and selling No both bid for Yes; selling Yes and buying No both offer it. */
export function yesTerms(o: BookOrder): { kind: 'bid' | 'ask'; yesPrice: number } {
  if (o.outcome === 'yes') return { kind: o.side === 'buy' ? 'bid' : 'ask', yesPrice: o.price };
  return { kind: o.side === 'buy' ? 'ask' : 'bid', yesPrice: 100 - o.price };
}

export interface Level {
  price: number;
  qty: bigint;
}

export interface Ladder {
  /** offers to sell Yes, cheapest first */
  asks: Level[];
  /** offers to buy Yes, highest first */
  bids: Level[];
}

function addTo(levels: Map<number, bigint>, price: number, qty: bigint) {
  levels.set(price, (levels.get(price) ?? 0n) + qty);
}

export function ladder(orders: BookOrder[]): Ladder {
  const asks = new Map<number, bigint>();
  const bids = new Map<number, bigint>();
  for (const o of orders) {
    const t = yesTerms(o);
    addTo(t.kind === 'ask' ? asks : bids, t.yesPrice, o.qty);
  }
  const toList = (m: Map<number, bigint>) => [...m].map(([price, qty]) => ({ price, qty }));
  return { asks: toList(asks).sort((a, b) => a.price - b.price), bids: toList(bids).sort((a, b) => b.price - a.price) };
}

export function bestAsk(l: Ladder): number | null {
  return l.asks.length ? l.asks[0].price : null;
}
export function bestBid(l: Ladder): number | null {
  return l.bids.length ? l.bids[0].price : null;
}
/** The gap between the best offer to sell and the best offer to buy, in cents. Null when either side is empty. */
export function gap(l: Ladder): number | null {
  const a = bestAsk(l);
  const b = bestBid(l);
  return a === null || b === null ? null : a - b;
}
/** What it costs to buy one share right now: Yes at the best ask; No at 100 minus the best bid. Null when nobody is offering. */
export function buyPrice(l: Ladder, outcome: Outcome): number | null {
  if (outcome === 'yes') return bestAsk(l);
  const b = bestBid(l);
  return b === null ? null : 100 - b;
}
/** What one share costs and what it makes when right, from its price in cents of the payout. */
export function shareMath(price: number, unit: bigint): { cost: bigint; profit: bigint } {
  const cents = BigInt(Math.max(0, Math.min(100, Math.round(price))));
  const cost = (unit * cents) / 100n;
  return { cost, profit: unit - cost };
}
/** The market's "chance of Yes": the midpoint of the best bid and ask, or the one side that exists, or null for an empty book. */
export function chance(l: Ladder): number | null {
  const a = bestAsk(l);
  const b = bestBid(l);
  if (a !== null && b !== null) return (a + b) / 2;
  return a ?? b;
}

// ---------------------------------------------------------------------------------------------------------------------
// Quotes: what an order would do right now, before it is sent.
// ---------------------------------------------------------------------------------------------------------------------

export interface Fill {
  /** price per share in the terms of the outcome being bought or sold */
  price: number;
  qty: bigint;
}

export interface Quote {
  fills: Fill[];
  /** shares that trade at once */
  filledQty: bigint;
  /** shares left over that will wait in the book at the limit price */
  restingQty: bigint;
  /** base units paid (buy) or received (sell) for the shares that trade at once, before any fee */
  tradeValue: bigint;
  /** base units locked for the resting part (buys only; a resting sell holds shares, not coins) */
  locked: bigint;
  /** the taker fee on `tradeValue`, in base units */
  fee: bigint;
  /** buys: tradeValue + fee + locked. sells: what you receive, tradeValue - fee. */
  total: bigint;
  /** average price per share of the part that trades at once, in cents (null when nothing trades) */
  avgPrice: number | null;
}

/** Fee on a trade, in base units, rounded down exactly as the contract does (the contract's per-trade check relies on it). */
export function takerFee(tradeValue: bigint, feeBps: number): bigint {
  if (feeBps <= 0 || tradeValue <= 0n) return 0n;
  const bps = BigInt(feeBps);
  return (tradeValue * bps) / 10_000n;
}

/** How a fee splits: the waiting order's owner gets 20%, 20% waits for the right answer, the collector gets the rest. */
export function feeSplit(fee: bigint): { maker: bigint; answer: bigint; collector: bigint } {
  const maker = (fee * 20n) / 100n;
  const answer = (fee * 20n) / 100n;
  return { maker, answer, collector: fee - maker - answer };
}

/**
 * What a limit order does against the current ladder. Buying Yes or selling No takes from the offers/bids exactly as
 * the contract matches: at the resting price, which can be better than your limit. Whatever does not trade rests.
 */
export function quote(l: Ladder, outcome: Outcome, side: Side, limit: number, qty: bigint, unit: bigint, feeBps = 0): Quote {
  const cu = unit / 100n;
  // Which ladder side do we take from, and how does its Yes price turn into this outcome's price?
  const takesAsks = (outcome === 'yes') === (side === 'buy');
  const levels = takesAsks ? l.asks : l.bids;
  const own = (yesPrice: number) => (outcome === 'yes' ? yesPrice : 100 - yesPrice);
  const ok = (p: number) => (side === 'buy' ? p <= limit : p >= limit);

  let left = qty;
  const fills: Fill[] = [];
  let tradeValue = 0n;
  for (const lv of levels) {
    if (left <= 0n) break;
    const p = own(lv.price);
    if (!ok(p)) break;
    const take = lv.qty < left ? lv.qty : left;
    fills.push({ price: p, qty: take });
    tradeValue += BigInt(p) * take * cu;
    left -= take;
  }
  const filledQty = qty - left;
  const locked = side === 'buy' ? BigInt(limit) * left * cu : 0n;
  const fee = takerFee(tradeValue, feeBps);
  const total = side === 'buy' ? tradeValue + fee + locked : tradeValue - fee;
  // average in cents, kept to two decimals: tradeValue / (filledQty * cu)
  const avgPrice = filledQty > 0n ? Number((tradeValue * 10_000n) / (filledQty * cu)) / 10_000 : null;
  return { fills, filledQty, restingQty: left, tradeValue, locked, fee, total, avgPrice };
}

export interface Payoff {
  /** what you can lose at most (base units) */
  maxLoss: bigint;
  /** what you receive if your outcome wins */
  ifWin: bigint;
  /** what you receive if it loses (always nothing for a plain share) */
  ifLose: bigint;
  /** profit if it wins, as a share of what you paid, in whole percent (null when you pay nothing) */
  profitPct: number | null;
}

/** The picture before you slide: pay `cost`, hold `qty` shares, each winning share pays one `unit`. */
export function payoff(cost: bigint, qty: bigint, unit: bigint): Payoff {
  const ifWin = qty * unit;
  return { maxLoss: cost, ifWin, ifLose: 0n, profitPct: cost > 0n ? Number(((ifWin - cost) * 100n) / cost) : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Money text
// ---------------------------------------------------------------------------------------------------------------------

/** "62¢" */
export const cents = (p: number) => `${Math.round(p * 10) / 10}¢`;

/** Base units to a plain decimal string with at most `shown` decimals (rounded down, trailing zeros kept to 2). */
export function amountText(v: bigint, decimals: number, shown = 2): string {
  const neg = v < 0n;
  const x = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = x / base;
  let frac = (x % base).toString().padStart(decimals, '0').slice(0, shown);
  frac = frac.padEnd(shown, '0');
  return `${neg ? '-' : ''}${whole.toString()}${shown > 0 ? '.' + frac : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The contract's answer flow
// ---------------------------------------------------------------------------------------------------------------------

export type MarketState = 'open' | 'yes' | 'no' | 'invalid';
export type Stage = 'trading' | 'needs-answer' | 'answer-waiting' | 'disputed' | 'decided' | 'expired';

export interface Resolution {
  /** 0 Yes, 1 No, 2 Invalid, or null for "nobody has proposed" */
  proposed: number | null;
  proposedAt: number;
  disputedAt: number;
  disputed: boolean;
}

/** The bond to propose or dispute: BOND_SHARES shares' worth. */
export const bondOf = (unit: bigint): bigint => unit * BOND_SHARES;

/** Where a market is in its life, in the words the screens use. `now` and `close` are unix seconds. */
export function stageOf(state: MarketState, close: number, res: Resolution, now: number): Stage {
  if (state !== 'open') return 'decided';
  if (now < close) return 'trading';
  if (res.disputed) return now >= res.disputedAt + EXPIRE_SECS ? 'expired' : 'disputed';
  if (res.proposed !== null) return 'answer-waiting';
  return now >= close + EXPIRE_SECS ? 'expired' : 'needs-answer';
}

/** Seconds until an undisputed answer can be finished; 0 once it can. */
export function challengeLeft(res: Resolution, now: number): number {
  if (res.proposed === null) return 0;
  return Math.max(0, res.proposedAt + WINDOW_SECS - now);
}

/** Share of the challenge window already used, 0 to 1. */
export function challengeUsed(res: Resolution, now: number): number {
  if (res.proposed === null) return 0;
  return Math.min(1, Math.max(0, (now - res.proposedAt) / WINDOW_SECS));
}

/** "18 h 22 m", "5 m", "40 s", or "now". */
export function clockText(secs: number): string {
  if (secs <= 0) return 'now';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} m`;
  if (m > 0) return `${m} m`;
  return `${Math.floor(secs)} s`;
}

/** "12 days", "5 hours", "20 minutes" until a market closes; "closed" once it has. */
export function closesText(close: number, now: number): string {
  const s = close - now;
  if (s <= 0) return 'Closed';
  if (s >= 2 * 86_400) return `Closes in ${Math.floor(s / 86_400)} days`;
  if (s >= 3600) return `Closes in ${Math.floor(s / 3600)} hours`;
  return `Closes in ${Math.max(1, Math.floor(s / 60))} minutes`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Price history, for the charts. The contract's `Traded` event feeds this; nothing here needs a server.
// ---------------------------------------------------------------------------------------------------------------------

export interface Trade {
  /** unix seconds */
  at: number;
  /** price of Yes in cents the trade happened at */
  yesPrice: number;
  qty: bigint;
}

export interface Point {
  at: number;
  price: number;
}

export type Range = '1H' | '1D' | '1W' | 'ALL';
export const RANGE_SECS: Record<Exclude<Range, 'ALL'>, number> = { '1H': 3600, '1D': 86_400, '1W': 604_800 };

/**
 * The line to draw: the last traded price at each of `buckets` evenly spaced moments across the range, carried forward
 * when nothing traded in between. Before the first trade it is empty, so a new market shows no line rather than a fake one.
 */
export function series(trades: Trade[], range: Range, now: number, buckets = 48): Point[] {
  const sorted = [...trades].sort((a, b) => a.at - b.at);
  if (!sorted.length) return [];
  const from = range === 'ALL' ? sorted[0].at : now - RANGE_SECS[range];
  const span = Math.max(1, now - from);
  const out: Point[] = [];
  let i = 0;
  let last: number | null = null;
  // the last price before the window starts is where the line begins
  while (i < sorted.length && sorted[i].at <= from) last = sorted[i++].yesPrice;
  for (let b = 0; b < buckets; b++) {
    const t = from + (span * b) / (buckets - 1);
    while (i < sorted.length && sorted[i].at <= t) last = sorted[i++].yesPrice;
    if (last !== null) out.push({ at: Math.round(t), price: last });
  }
  return out;
}

/** Change from the first to the last point, in cents; null with fewer than two points. */
export function change(points: Point[]): number | null {
  return points.length < 2 ? null : points[points.length - 1].price - points[0].price;
}

// ---------------------------------------------------------------------------------------------------------------------
// Your positions
// ---------------------------------------------------------------------------------------------------------------------

export interface Position {
  outcome: Outcome;
  qty: bigint;
}

/** What a position is worth at today's best bid for that outcome (what you could sell for right now), in base units. */
export function positionValue(p: Position, l: Ladder, unit: bigint): bigint {
  const bid = p.outcome === 'yes' ? bestBid(l) : (() => { const a = bestAsk(l); return a === null ? null : 100 - a; })();
  if (bid === null) return 0n;
  return BigInt(bid) * p.qty * (unit / 100n);
}

/** Profit or loss against what you paid, in base units; null when the cost is not known. */
export function profit(value: bigint, cost: bigint | null): bigint | null {
  return cost === null ? null : value - cost;
}

/** Whether a share transfer, claim or sale must stop: the market's book is empty on the side you need. */
export function canSellNow(p: Position, l: Ladder): boolean {
  return p.qty > 0n && (p.outcome === 'yes' ? bestBid(l) !== null : bestAsk(l) !== null);
}
