import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivals, readFrom } from '../src/lib/arrivals-core.ts';

test('a balance that went up is a deposit', () => {
  assert.deepEqual(arrivals({ 'btc:a': 100n, 'eth:a': 5n }, { 'btc:a': 150n, 'eth:a': 5n }), [{ key: 'btc:a', delta: 50n }]);
});

test('the first look, a drop, or a new coin or network is not a deposit', () => {
  assert.deepEqual(arrivals(null, { 'btc:a': 100n }), []);
  assert.deepEqual(arrivals({ 'btc:a': 100n }, { 'btc:a': 40n }), []);
  assert.deepEqual(arrivals({ 'btc:a': 100n }, { 'btc:a': 100n, 'sol:b': 9n, 'btc:other': 7n }), []);
});

test('several coins can arrive at once', () => {
  const r = arrivals({ a: 1n, b: 1n }, { a: 2n, b: 3n });
  assert.deepEqual(r.map((x) => x.key), ['a', 'b']);
});

test('a balance still held from the previous network is not filed under the new one', () => {
  const loaded = { eth: 'sepolia' };
  assert.equal(readFrom(loaded, 'eth', 'sepolia'), true);
  assert.equal(readFrom(loaded, 'eth', 'bnb-testnet'), false); // switched to BNB: the number on hand is still Sepolia's
  assert.equal(readFrom({}, 'eth', 'sepolia'), false); // nothing read yet
  // so the stale number never enters the books, and the first real read is a first look, not a deposit
  const prev = null;
  assert.deepEqual(arrivals(prev, { 'eth:bnb-testnet:0xa': 2n }), []);
});
