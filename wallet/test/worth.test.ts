import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthTotals, shouldRecord, thenNow } from '../src/lib/worth-core.ts';

test('a price is written down only for new payments, once', () => {
  const now = 1_000_000;
  assert.equal(shouldRecord({}, 'a', 0, now), true);
  assert.equal(shouldRecord({}, 'a', now - 600, now), true);
  assert.equal(shouldRecord({}, 'a', now - 3 * 3600, now), false);
  assert.equal(shouldRecord({ a: { p: 1, c: 'usd' } }, 'a', 0, now), false);
});
test('worth then and now', () => {
  const r = thenNow(0.25, { p: 3248, c: 'usd' }, 3560, 'usd')!;
  assert.equal(Math.round(r.then), 812);
  assert.equal(Math.round(r.now), 890);
  assert.equal(r.pct.toFixed(1), '9.6');
  assert.equal(thenNow(1, undefined, 5, 'usd'), null);
  assert.equal(thenNow(1, { p: 1, c: 'inr' }, 5, 'usd'), null);
});
test('this month: only priced payments are counted, the rest are said out loud', () => {
  const now = new Date(2026, 10, 20);
  const t = (d: number) => new Date(2026, 10, d, 12).getTime() / 1000;
  const map = { a: { p: 100, c: 'usd' as const }, b: { p: 100, c: 'usd' as const } };
  const r = monthTotals([
    { id: 'a', time: t(5), amount: 2, kind: 'sent', symbol: 'ETH' },
    { id: 'b', time: t(6), amount: 1, kind: 'received', symbol: 'ETH' },
    { id: 'c', time: t(7), amount: 9, kind: 'sent', symbol: 'ETH' },
    { id: 'd', time: new Date(2026, 9, 30).getTime() / 1000, amount: 9, kind: 'sent', symbol: 'ETH' },
    { id: 'e', time: t(8), amount: 9, kind: 'sent' },
  ], map, 'usd', now);
  assert.deepEqual(r, { spent: 200, got: 100, sentN: 1, gotN: 1, unpriced: 1 });
});
