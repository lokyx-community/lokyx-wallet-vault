import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSpent, overLimit, spentToday } from '../src/lib/limits-core.ts';
import { balanceDrop, newSends } from '../src/lib/watch-core.ts';

const noon = Date.UTC(2026, 0, 5, 12);
test('daily limit adds up within a day and resets the next', () => {
  let s = addSpent(undefined, noon, 5n);
  s = addSpent(s, noon + 1000, 7n);
  assert.equal(spentToday(s, noon), 12n);
  assert.equal(spentToday(s, noon + 86_400_000), 0n);
});
test('over the limit only when the total passes it', () => {
  assert.equal(overLimit(null, 0n, 99n), false);
  assert.equal(overLimit(0n, 0n, 99n), false);
  assert.equal(overLimit(10n, 4n, 6n), false);
  assert.equal(overLimit(10n, 4n, 7n), true);
});
test('send alerts: new sends only, and balance drops', () => {
  const seen = new Set<string>();
  const items = [{ kind: 'sent', txHash: '0xab' }, { kind: 'received', txHash: '0xcd' }] as never;
  assert.equal(newSends('a', items, seen).length, 1);
  assert.equal(balanceDrop('100', 60n), 40n);
  assert.equal(balanceDrop('100', 160n), 0n);
  assert.equal(balanceDrop(undefined, 5n), 0n);
});

import { checkDue, choices, pickChecks } from '../src/lib/backup-check-core.ts';
test('backup check: three distinct sorted positions, four choices, due after a month', () => {
  const c = pickChecks(24);
  assert.equal(new Set(c).size, 3);
  assert.deepEqual(c, [...c].sort((a, b) => a - b));
  const o = choices('apple', ['apple', 'bean', 'cat'], ['dog', 'eel', 'fox', 'gnu']);
  assert.equal(o.length, 4);
  assert.ok(o.includes('apple'));
  const now = Date.now();
  assert.equal(checkDue(undefined, now), true);
  assert.equal(checkDue(now - 5 * 86_400_000, now), false);
  assert.equal(checkDue(now - 40 * 86_400_000, now), true);
});
