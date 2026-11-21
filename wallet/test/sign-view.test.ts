import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capApproval, combineTone, typedAmount } from '../src/lib/sign-view-core.ts';

test('the worse of the two checks wins', () => {
  assert.equal(combineTone('allow', 'ok'), 'allow');
  assert.equal(combineTone('allow', 'caution'), 'review');
  assert.equal(combineTone('review', 'ok'), 'review');
  assert.equal(combineTone('allow', 'danger'), 'stop');
  assert.equal(combineTone('stop', 'ok'), 'stop');
  assert.equal(combineTone(null, null), 'allow');
});

test('an approval is rewritten to a smaller amount, and only an approval', () => {
  const spender = '1111111111111111111111111111111111111111'.padStart(64, '0');
  const max = 'f'.repeat(64);
  const data = `0x095ea7b3${spender}${max}`;
  const out = capApproval(data, 100_000_000n);
  assert.equal(out, `0x095ea7b3${spender}${(100_000_000n).toString(16).padStart(64, '0')}`);
  assert.equal(capApproval('0xa9059cbb' + spender + max, 1n), null);
  assert.equal(capApproval(data, -1n), null);
  assert.equal(capApproval(data, 1n << 256n), null);
});

test('typed amounts', () => {
  assert.equal(typedAmount('100', 6), 100_000_000n);
  assert.equal(typedAmount('0.5', 6), 500_000n);
  assert.equal(typedAmount('1.1234567', 6), null);
  assert.equal(typedAmount('abc', 6), null);
  assert.equal(typedAmount('', 6), null);
});
