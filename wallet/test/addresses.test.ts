import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allAddresses, btcKey, ethKey } from '../src/lib/multichain-core.ts';

const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

test('allAddresses matches the per-chain keys', () => {
  const a = allAddresses(words);
  for (const n of ['signet', 'testnet4', 'testnet', 'mainnet'] as const) assert.equal(a.btc[n], btcKey(words, n).address);
  assert.equal(a.eth, ethKey(words).address);
  assert.match(a.btc.mainnet, /^bc1q/);
  assert.match(a.btc.testnet4, /^tb1q/);
  assert.match(a.eth, /^0x[0-9a-fA-F]{40}$/);
});
