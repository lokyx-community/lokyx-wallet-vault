import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btcSweepAmount, encodeGift, giftAddress, newGiftKey, parseGift } from '../src/lib/gift-core.ts';

test('a gift card round-trips and gives the same address on each coin', () => {
  const sk = newGiftKey();
  for (const coin of ['lyx', 'btc', 'eth'] as const) {
    const g = parseGift(`Here you go! ${encodeGift(coin, sk)}`);
    assert.ok(g);
    assert.equal(g.coin, coin);
    assert.equal(giftAddress(coin, g.sk), giftAddress(coin, sk));
  }
  assert.match(giftAddress('lyx', sk), /^lyx1/);
  assert.match(giftAddress('btc', sk), /^tb1q/);
  assert.match(giftAddress('eth', sk), /^0x[0-9a-fA-F]{40}$/);
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
