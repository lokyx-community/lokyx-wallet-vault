import test from 'node:test';
import assert from 'node:assert/strict';
import { qrValue, tapValue, shortCard, dotLayout, startIndex } from '../src/lib/receive-core.ts';

const A = '0x7a3F9c1e2B4d58a06E91c3d7F2b8A4c05D6e1B93';
const TOK = { id: 'u', symbol: 'USDT', contract: '0x3370000000000000000000000000000000005c8d', decimals: 6 };

test('QR for a token with no amount is just the address, with an amount it is that exact token', () => {
  assert.equal(qrValue({ chain: 'eth', address: A, token: TOK, chainId: 97 }), A);
  assert.equal(qrValue({ chain: 'eth', address: A, token: TOK, amount: '2.5', chainId: 97 }), `ethereum:${TOK.contract}@97/transfer?address=${A}&uint256=2500000`);
});
test('QR per coin', () => {
  assert.equal(qrValue({ chain: 'lyx', address: 'lyx1abc' }), 'lokyx:lyx1abc');
  assert.equal(qrValue({ chain: 'lyx', address: 'lyx1abc', amount: '5' }), 'lokyx:lyx1abc?amount=5');
  assert.equal(qrValue({ chain: 'btc', address: 'tb1qabc' }), 'bitcoin:tb1qabc');
  assert.equal(qrValue({ chain: 'sol', address: 'So1', token: { id: 'm', symbol: 'USDC', contract: 'mint' } }), 'So1');
  assert.equal(qrValue({ chain: 'eth', address: A, chainId: 97 }), A);
});
test('tap sends the token itself when one is chosen', () => {
  assert.equal(tapValue({ chain: 'eth', address: A, token: TOK, chainId: 97 }), `ethereum:${TOK.contract}@97/transfer?address=${A}`);
  assert.equal(tapValue({ chain: 'eth', address: A, chainId: 97 }), A);
  assert.equal(tapValue({ chain: 'lyx', address: 'lyx1abc' }), 'lokyx:lyx1abc');
});
test('shortCard keeps both ends', () => {
  assert.equal(shortCard(A), '0x7a3F … e1B93');
  assert.equal(shortCard('short'), 'short');
});
test('dotLayout: corner squares and the hole are not dots, nothing else is lost', () => {
  const n = 29;
  const cells: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x * 7 + y * 13 + x * y) % 3 !== 0) cells.push([x, y]);
  const d = dotLayout(n, cells);
  assert.equal(d.eyes.length, 3);
  assert.ok(d.hole.size % 2 === 1 && d.hole.size >= 3);
  assert.ok(d.hole.size * d.hole.size / (n * n) < 0.06, 'hole stays small');
  for (const [x, y] of d.dots) {
    assert.ok(!((x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)));
    assert.ok(!(x >= d.hole.from && x < d.hole.from + d.hole.size && y >= d.hole.from && y < d.hole.from + d.hole.size));
  }
  assert.equal(dotLayout(n, cells, false).hole.size, 0);
  assert.ok(dotLayout(n, cells, false).dots.length > d.dots.length);
});
test('startIndex', () => {
  const ids = ['lyx', 'eth', 'btc', 'trx'];
  assert.equal(startIndex(ids), 0);
  assert.equal(startIndex(ids, 'btc'), 2);
  assert.equal(startIndex(ids, undefined, '0xabc'), 1);
  assert.equal(startIndex(ids, 'sol'), 0);
  assert.equal(startIndex(ids, 'bogus'), 0);
});
