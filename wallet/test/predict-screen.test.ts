import test from 'node:test';
import assert from 'node:assert/strict';
import { ladder, type BookOrder } from '../src/lib/predict-core.ts';
import { parseQty, tradeView, startPrice, stageLabel, receiptFacts } from '../src/lib/predict-screen-core.ts';

const ord = (id: number, outcome: 'yes' | 'no', side: 'buy' | 'sell', price: number, qty: number): BookOrder => ({ id: BigInt(id), owner: '0x1', outcome, side, price, qty: BigInt(qty) });
// someone sells 10 Yes at 60, someone bids 6 Yes at 55
const book = ladder([ord(1, 'yes', 'sell', 60, 10), ord(2, 'yes', 'buy', 55, 6)]);
const UNIT = 1000n; // 10 base units per cent

test('share counts: whole numbers from 1 to 10,000 only', () => {
  assert.equal(parseQty('5'), 5n);
  assert.equal(parseQty(' 10000 '), 10000n);
  for (const bad of ['', '0', '10001', '1.5', '-3', 'abc', '1e3', '007x']) assert.equal(parseQty(bad), null, bad);
});

test('buying takes the cheapest offer, adds the fee, and says what you can win', () => {
  const v = tradeView({ ladder: book, outcome: 'yes', side: 'buy', limit: 60, qty: 5n, unit: UNIT, feeBps: 100, free: 10_000n, have: 0n });
  assert.equal(v.why, null);
  assert.equal(v.q!.tradeValue, 3000n);
  assert.equal(v.q!.fee, 30n);
  assert.equal(v.pay!.maxLoss, 3030n);
  assert.equal(v.pay!.ifWin, 5000n);
});

test('not enough balance: says so and how much is missing', () => {
  const v = tradeView({ ladder: book, outcome: 'yes', side: 'buy', limit: 60, qty: 5n, unit: UNIT, feeBps: 100, free: 3000n, have: 0n });
  assert.equal(v.short, 30n);
  assert.match(v.why!, /Not enough/);
});

test('a bid below the offer rests in the book and locks its coins', () => {
  const v = tradeView({ ladder: book, outcome: 'yes', side: 'buy', limit: 58, qty: 4n, unit: UNIT, feeBps: 100, free: 10_000n, have: 0n });
  assert.equal(v.q!.filledQty, 0n);
  assert.equal(v.q!.restingQty, 4n);
  assert.equal(v.q!.locked, 2320n);
});

test('selling needs the shares; missing pieces switch the slide off', () => {
  assert.match(tradeView({ ladder: book, outcome: 'yes', side: 'sell', limit: 55, qty: 3n, unit: UNIT, feeBps: 100, free: 0n, have: 2n }).why!, /hold 2 Yes shares/);
  assert.equal(tradeView({ ladder: book, outcome: 'yes', side: 'sell', limit: 55, qty: 3n, unit: UNIT, feeBps: 100, free: 0n, have: 3n }).why, null);
  assert.match(tradeView({ ladder: book, outcome: 'yes', side: 'buy', limit: 60, qty: null, unit: UNIT, feeBps: 100, free: 1n, have: 0n }).why!, /how many/);
  assert.match(tradeView({ ladder: book, outcome: 'yes', side: 'buy', limit: 100, qty: 1n, unit: UNIT, feeBps: 100, free: 1n, have: 0n }).why!, /between 1¢ and 99¢/);
});

test('start price follows the book, for Yes and for No, and falls back when a side is empty', () => {
  assert.equal(startPrice(book, 'yes', 'buy', null), 60);
  assert.equal(startPrice(book, 'no', 'buy', null), 45);
  assert.equal(startPrice(book, 'yes', 'sell', null), 55);
  assert.equal(startPrice(ladder([]), 'yes', 'buy', 70), 70);
  assert.equal(startPrice(ladder([]), 'no', 'buy', 70), 30);
  assert.equal(startPrice(ladder([]), 'yes', 'buy', null), 50);
});

test('card lines', () => {
  assert.equal(stageLabel('trading', 'open', 'Closes in 2 d'), 'Closes in 2 d');
  assert.equal(stageLabel('decided', 'no', ''), 'Decided: No');
  assert.equal(stageLabel('needs-answer', 'open', ''), 'Waiting for an answer');
});

test('receipt words: filled, partly filled, resting, failed', () => {
  const base = { outcome: 'yes' as const, side: 'buy' as const, limit: 62, unit: 10n ** 18n, decimals: 18 };
  assert.equal(receiptFacts({ ...base, qty: 5n, ok: true, fills: [{ yesPrice: 60, qty: 5n }] }).headline, 'Bought 5 Yes shares at 60¢ each');
  const part = receiptFacts({ ...base, qty: 10n, ok: true, fills: [{ yesPrice: 60, qty: 4n }] });
  assert.match(part.detail, /6 more wait in the book at 62¢/);
  assert.equal(receiptFacts({ ...base, qty: 3n, ok: true, fills: [] }).verb, 'Placed');
  assert.equal(receiptFacts({ ...base, qty: 3n, ok: false, fills: [] }).verb, 'Not done');
  const no = receiptFacts({ ...base, outcome: 'no', qty: 2n, ok: true, fills: [{ yesPrice: 60, qty: 2n }] });
  assert.equal(no.headline, 'Bought 2 No shares at 40¢ each');
});

import { parsePanel, marketForm } from '../src/lib/predict-screen-core.ts';
const A = (n: number) => '0x' + n.toString(16).padStart(40, '0');

test('panel: 3 to 9 different addresses, split on lines, spaces or commas', () => {
  assert.equal(parsePanel(`${A(1)}\n${A(2)}, ${A(3)}`).why, null);
  assert.match(parsePanel(`${A(1)} ${A(2)}`).why!, /at least 3/);
  assert.match(parsePanel(`${A(1)} ${A(2)} ${A(1)}`).why!, /twice/);
  assert.match(parsePanel(`${A(1)} ${A(2)} nonsense`).why!, /not an address/);
  assert.match(parsePanel(Array.from({ length: 10 }, (_, i) => A(i + 1)).join(' ')).why!, /No more than 9/);
});

test('the make-a-market form says what is missing, question first', () => {
  const ok = [A(1), A(2), A(3)].join('\n');
  assert.match(marketForm({ title: '  ', panel: ok }).why!, /question/);
  assert.match(marketForm({ title: 'x'.repeat(201), panel: ok }).why!, /under 200/);
  assert.match(marketForm({ title: 'Will it rain?', panel: A(1) }).why!, /at least 3/);
  assert.equal(marketForm({ title: 'Will it rain?', panel: ok }).why, null);
  assert.equal(marketForm({ title: 'Will it rain?', panel: ok }).panel.length, 3);
});
