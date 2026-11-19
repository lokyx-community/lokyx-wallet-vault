import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivals } from '../src/lib/arrivals-core.ts';

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
