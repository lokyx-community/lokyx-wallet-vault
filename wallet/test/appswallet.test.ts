import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS_INDEX, accountIndexFor, arrivalText, refillPlan } from '../src/lib/appswallet-core.ts';

test('a top-up inside the allowance is instant', () => {
  const p = refillPlan(100n, 200n, 86400, 1_000);
  assert.equal(p.instant, true);
  assert.equal(p.waitSecs, 0);
  assert.equal(p.arrivesAt, 1_000);
});
test('a top-up above the allowance waits the vault wait', () => {
  const p = refillPlan(500n, 200n, 86400, 1_000);
  assert.equal(p.instant, false);
  assert.equal(p.arrivesAt, 1_000 + 86400_000);
});
test('exactly the allowance is still instant', () => assert.equal(refillPlan(200n, 200n, 86400, 0).instant, true));
test('arrival text says today or tomorrow', () => {
  const now = new Date(2026, 0, 5, 10, 0).getTime();
  assert.match(arrivalText(now + 3600_000, now), /^Arrives today /);
  assert.match(arrivalText(now + 86400_000, now), /^Arrives tomorrow /);
});
test('the Apps wallet address maps to its own key, anything else to the main key', () => {
  assert.equal(accountIndexFor('0xAbC', '0xabc'), APPS_INDEX);
  assert.equal(accountIndexFor('0xdef', '0xabc'), 0);
  assert.equal(accountIndexFor('0xdef', null), 0);
});
