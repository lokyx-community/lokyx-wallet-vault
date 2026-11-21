import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btcSweepAmount, encodeGift, giftAddress, newGiftKey, parseGift } from '../src/lib/gift-core.ts';

test('a gift card round-trips and gives the same address on each coin', () => {
  const sk = newGiftKey();
  for (const coin of ['lyx', 'btc', 'eth', 'trx'] as const) {
    const g = parseGift(`Here you go! ${encodeGift(coin, sk)}`);
    assert.ok(g);
    assert.equal(g.coin, coin);
    assert.equal(giftAddress(coin, g.sk), giftAddress(coin, sk));
  }
  assert.match(giftAddress('lyx', sk), /^lyx1/);
  assert.match(giftAddress('btc', sk), /^tb1q/);
  assert.match(giftAddress('eth', sk), /^0x[0-9a-fA-F]{40}$/);
  assert.match(giftAddress('trx', sk), /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
});

test('a Solana gift uses a plain ed25519 seed and round-trips', () => {
  const sk = newGiftKey('sol');
  assert.equal(sk.length, 32);
  const g = parseGift(encodeGift('sol', sk));
  assert.ok(g);
  assert.equal(g.coin, 'sol');
  assert.equal(giftAddress('sol', g.sk), giftAddress('sol', sk));
  assert.match(giftAddress('sol', sk), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(parseGift('lokyx-gift:sol:' + '00'.repeat(32)), null);
});

test('junk is not a gift', () => {
  assert.equal(parseGift('lokyx-gift:doge:' + '11'.repeat(32)), null);
  assert.equal(parseGift('lokyx-gift:lyx:' + '00'.repeat(32)), null);
  assert.equal(parseGift('hello'), null);
});

test('a Bitcoin sweep pays the fee out of the gift', () => {
  const { amount, fee } = btcSweepAmount(100_000n, 2, 2);
  assert.equal(fee, 355n);
  assert.equal(amount, 99_645n);
});
