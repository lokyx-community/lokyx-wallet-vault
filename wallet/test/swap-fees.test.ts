import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_BPS, FEE_CHARGED, INSTANT_BPS, bpsFor, directReady, feeOn, fromUnits, percentText, toUnits } from '../src/lib/swap-fees.ts';

test('the two fees: 0.5% for Instant, 0.2% for Direct, not charged yet', () => {
  assert.equal(percentText(INSTANT_BPS), '0.5%');
  assert.equal(percentText(DIRECT_BPS), '0.2%');
  assert.equal(percentText(100), '1%');
  assert.equal(bpsFor('instant'), 50);
  assert.equal(bpsFor('direct'), 20);
  assert.equal(FEE_CHARGED, false);
});

test('the fee rounds down and is never above the stated percentage', () => {
  assert.equal(feeOn(1_000_000n, 50), 5_000n);
  assert.equal(feeOn(1_000_000n, 20), 2_000n);
  assert.equal(feeOn(199n, 50), 0n); // 0.995 rounds down to 0
  assert.equal(feeOn(0n, 50), 0n);
  assert.equal(feeOn(-5n, 50), 0n);
  const a = 123_456_789_012_345_678n;
  assert.ok(feeOn(a, 50) * 10_000n <= a * 50n);
});

test('direct swaps are ready only for LYX with Bitcoin or Ethereum, either way round', () => {
  assert.equal(directReady('lyx', 'btc'), true);
  assert.equal(directReady('eth', 'lyx'), true);
  assert.equal(directReady('btc', 'eth'), false);
  assert.equal(directReady('lyx', 'sol'), false);
  assert.equal(directReady('btc', 'btc'), false);
});

test('amounts: typed text to smallest units and back', () => {
  assert.equal(toUnits('1.5', 8), 150_000_000n);
  assert.equal(toUnits('.5', 18), 500_000_000_000_000_000n);
  assert.equal(toUnits('1,000.25', 6), 1_000_250_000n);
  assert.equal(toUnits('0.123456789', 8), null); // more places than the coin has
  assert.equal(toUnits('abc', 8), null);
  assert.equal(toUnits('', 8), null);
  assert.equal(toUnits('.', 8), null);
  assert.equal(fromUnits(150_000_000n, 8), '1.5');
  assert.equal(fromUnits(5n, 8), '0.00000005');
  assert.equal(fromUnits(1_234_567_890n, 8, 4), '12.3456');
  assert.equal(fromUnits(100n, 2), '1');
});

test('gift cards: 0.2% in the same coin, nothing asked while fees are off or a coin has no fee address', async () => {
  const { GIFT_BPS, giftFee, FEE_ADDRESS } = await import('../src/lib/swap-fees.ts');
  assert.equal(GIFT_BPS, 20);
  assert.equal(feeOn(50_000_000_000_000_000_000n, GIFT_BPS), 100_000_000_000_000_000n); // 50 LYX -> 0.1 LYX
  assert.equal(feeOn(1_000_000n, GIFT_BPS), 2_000n); // 0.01 BTC -> 0.00002 BTC
  assert.equal(giftFee('lyx', 50n * 10n ** 18n), 0n);
  assert.deepEqual(FEE_ADDRESS, {});
});
