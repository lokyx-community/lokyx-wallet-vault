import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBook, yesTerms, ladder, bestAsk, bestBid, gap, buyPrice, chance, quote, takerFee, payoff, amountText, cents,
  stageOf, challengeLeft, challengeUsed, clockText, closesText, bondOf, series, change, positionValue, canSellNow,
  WINDOW_SECS, EXPIRE_SECS,
  type BookOrder,
} from '../src/lib/predict-core.ts';

const UNIT = 1_000_000_000_000_000_000n; // 1 token
const cu = UNIT / 100n;
const o = (id: number, outcome: 'yes' | 'no', side: 'buy' | 'sell', price: number, qty: number): BookOrder => ({
  id: BigInt(id), owner: '0x' + id, outcome, side, price, qty: BigInt(qty),
});

test('parseBook reads the contract arrays', () => {
  const b = parseBook({ ids: [1n, 2n], owners: ['a', 'b'], outcomes: [0, 1], sides: [0, 1], prices: [40, 70], qtys: [5n, 6n] });
  assert.deepEqual(b.map((x) => [x.outcome, x.side, x.price, x.qty]), [['yes', 'buy', 40, 5n], ['no', 'sell', 70, 6n]]);
});

test('yesTerms puts every order on the Yes ladder', () => {
  assert.deepEqual(yesTerms(o(1, 'yes', 'buy', 40, 1)), { kind: 'bid', yesPrice: 40 });
  assert.deepEqual(yesTerms(o(1, 'yes', 'sell', 60, 1)), { kind: 'ask', yesPrice: 60 });
  assert.deepEqual(yesTerms(o(1, 'no', 'buy', 35, 1)), { kind: 'ask', yesPrice: 65 });
  assert.deepEqual(yesTerms(o(1, 'no', 'sell', 30, 1)), { kind: 'bid', yesPrice: 70 });
});

const book = [
  o(1, 'yes', 'buy', 58, 10), o(2, 'no', 'sell', 40, 5), // bids at 58 and 60
  o(3, 'yes', 'sell', 62, 8), o(4, 'no', 'buy', 36, 4), o(5, 'yes', 'sell', 62, 2), // asks at 62 (x10) and 64
];

test('ladder merges levels and sorts them', () => {
  const l = ladder(book);
  assert.deepEqual(l.bids, [{ price: 60, qty: 5n }, { price: 58, qty: 10n }]);
  assert.deepEqual(l.asks, [{ price: 62, qty: 10n }, { price: 64, qty: 4n }]);
  assert.equal(bestAsk(l), 62);
  assert.equal(bestBid(l), 60);
  assert.equal(gap(l), 2);
  assert.equal(chance(l), 61);
  assert.equal(buyPrice(l, 'yes'), 62);
  assert.equal(buyPrice(l, 'no'), 40);
});

test('empty and one-sided books', () => {
  const e = ladder([]);
  assert.equal(chance(e), null);
  assert.equal(gap(e), null);
  assert.equal(buyPrice(e, 'yes'), null);
  assert.equal(buyPrice(e, 'no'), null);
  const oneSide = ladder([o(1, 'yes', 'buy', 30, 1)]);
  assert.equal(chance(oneSide), 30);
  assert.equal(gap(oneSide), null);
});

test('quote: buying Yes takes asks at the resting price, rest waits', () => {
  const l = ladder(book);
  const q = quote(l, 'yes', 'buy', 63, 12n, UNIT);
  assert.deepEqual(q.fills, [{ price: 62, qty: 10n }]);
  assert.equal(q.filledQty, 10n);
  assert.equal(q.restingQty, 2n);
  assert.equal(q.tradeValue, 62n * 10n * cu);
  assert.equal(q.locked, 63n * 2n * cu);
  assert.equal(q.total, q.tradeValue + q.locked);
  assert.equal(q.avgPrice, 62);
});

test('quote: a limit below the best ask does not trade and locks in full', () => {
  const q = quote(ladder(book), 'yes', 'buy', 50, 4n, UNIT);
  assert.equal(q.filledQty, 0n);
  assert.equal(q.locked, 50n * 4n * cu);
  assert.equal(q.avgPrice, null);
});

test('quote: buying No takes the Yes bids, priced as 100 minus the Yes price', () => {
  const q = quote(ladder(book), 'no', 'buy', 45, 7n, UNIT);
  assert.deepEqual(q.fills, [{ price: 40, qty: 5n }, { price: 42, qty: 2n }]);
  assert.equal(q.tradeValue, (40n * 5n + 42n * 2n) * cu);
  assert.equal(q.restingQty, 0n);
});

test('quote: selling Yes hits the bids and receives, with no lock', () => {
  const q = quote(ladder(book), 'yes', 'sell', 59, 8n, UNIT);
  assert.deepEqual(q.fills, [{ price: 60, qty: 5n }]);
  assert.equal(q.restingQty, 3n);
  assert.equal(q.locked, 0n);
  assert.equal(q.total, 60n * 5n * cu);
});

test('quote: selling No lifts the Yes asks', () => {
  const q = quote(ladder(book), 'no', 'sell', 36, 3n, UNIT);
  assert.deepEqual(q.fills, [{ price: 38, qty: 3n }]);
});

test('fee: zero by default, rounded up, taken off a sale and added to a buy', () => {
  assert.equal(takerFee(1000n, 0), 0n);
  assert.equal(takerFee(0n, 100), 0n);
  assert.equal(takerFee(1000n, 100), 10n);
  assert.equal(takerFee(1001n, 100), 11n);
  const l = ladder(book);
  const buy = quote(l, 'yes', 'buy', 62, 10n, UNIT, 100);
  assert.equal(buy.fee, takerFee(62n * 10n * cu, 100));
  assert.equal(buy.total, buy.tradeValue + buy.fee);
  const sell = quote(l, 'yes', 'sell', 58, 5n, UNIT, 100);
  assert.equal(sell.total, sell.tradeValue - sell.fee);
});

test('payoff', () => {
  const p = payoff(62n * 10n * cu, 10n, UNIT);
  assert.equal(p.maxLoss, 6_200_000_000_000_000_000n);
  assert.equal(p.ifWin, 10n * UNIT);
  assert.equal(p.ifLose, 0n);
  assert.equal(p.profitPct, 61);
  assert.equal(payoff(0n, 1n, UNIT).profitPct, null);
});

test('text helpers', () => {
  assert.equal(cents(62), '62¢');
  assert.equal(cents(61.5), '61.5¢');
  assert.equal(amountText(6_200_000_000_000_000_000n, 18), '6.20');
  assert.equal(amountText(999n, 18), '0.00');
  assert.equal(amountText(-1_500_000_000_000_000_000n, 18), '-1.50');
  assert.equal(clockText(0), 'now');
  assert.equal(clockText(40), '40 s');
  assert.equal(clockText(300), '5 m');
  assert.equal(clockText(18 * 3600 + 22 * 60), '18 h 22 m');
  assert.equal(closesText(0, 10), 'Closed');
  assert.equal(closesText(12 * 86_400, 0), 'Closes in 12 days');
  assert.equal(closesText(5 * 3600, 0), 'Closes in 5 hours');
  assert.equal(closesText(1200, 0), 'Closes in 20 minutes');
});

test('stage of a market through its life', () => {
  const none = { proposed: null, proposedAt: 0, disputedAt: 0, disputed: false };
  assert.equal(stageOf('open', 1000, none, 500), 'trading');
  assert.equal(stageOf('open', 1000, none, 1000), 'needs-answer');
  assert.equal(stageOf('open', 1000, none, 1000 + EXPIRE_SECS), 'expired');
  const prop = { proposed: 0, proposedAt: 2000, disputedAt: 0, disputed: false };
  assert.equal(stageOf('open', 1000, prop, 2500), 'answer-waiting');
  const disp = { proposed: 0, proposedAt: 2000, disputedAt: 3000, disputed: true };
  assert.equal(stageOf('open', 1000, disp, 4000), 'disputed');
  assert.equal(stageOf('open', 1000, disp, 3000 + EXPIRE_SECS), 'expired');
  assert.equal(stageOf('yes', 1000, prop, 9e9), 'decided');
});

test('challenge window', () => {
  const r = { proposed: 1, proposedAt: 1000, disputedAt: 0, disputed: false };
  assert.equal(challengeLeft(r, 1000), WINDOW_SECS);
  assert.equal(challengeLeft(r, 1000 + WINDOW_SECS + 5), 0);
  assert.equal(challengeUsed(r, 1000 + WINDOW_SECS / 2), 0.5);
  assert.equal(challengeUsed({ ...r, proposed: null }, 5000), 0);
  assert.equal(bondOf(UNIT), 20n * UNIT);
});

test('series carries the last price forward and starts at the first trade', () => {
  const now = 10_000;
  assert.deepEqual(series([], '1D', now), []);
  const trades = [{ at: 9_000, yesPrice: 50, qty: 1n }, { at: 9_500, yesPrice: 60, qty: 1n }];
  const s = series(trades, '1H', now, 5);
  // five moments from 6400 to 10000; the first trade is at 9000, so only the last two moments have a price
  assert.equal(s.length, 2);
  assert.equal(s[0].price, 50);
  assert.equal(s[s.length - 1].price, 60);
  // a range that starts before the first trade has no points until the first trade
  const early = series(trades, '1W', now, 8);
  // a week is wide: only the final moment is after both trades, so one point at the latest price
  assert.equal(early.length, 1);
  assert.equal(early[0].price, 60);
  assert.equal(change(s), 10);
  assert.equal(change([]), null);
});

test('positions are valued at what you could sell for', () => {
  const l = ladder(book);
  assert.equal(positionValue({ outcome: 'yes', qty: 10n }, l, UNIT), 60n * 10n * cu);
  assert.equal(positionValue({ outcome: 'no', qty: 10n }, l, UNIT), 38n * 10n * cu);
  assert.equal(positionValue({ outcome: 'yes', qty: 10n }, ladder([]), UNIT), 0n);
  assert.equal(canSellNow({ outcome: 'yes', qty: 1n }, l), true);
  assert.equal(canSellNow({ outcome: 'yes', qty: 0n }, l), false);
  assert.equal(canSellNow({ outcome: 'no', qty: 1n }, ladder([])), false);
});
