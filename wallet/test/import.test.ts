import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH_STYLES, onlyWithMoney, parsePrivateKey, scanTargets, wordCountOk, type FoundAddress } from '../src/lib/import-core.ts';

test('both layouts give the paths wallets use', () => {
  assert.equal(PATH_STYLES[0].path(2), "m/44'/60'/0'/0/2");
  assert.equal(PATH_STYLES[1].path(2), "m/44'/60'/2'/0/0");
});
test('the scan looks at a few accounts in each layout', () => assert.equal(scanTargets(3).length, 6));
test('a private key is 64 hex characters, with or without 0x', () => {
  const k = 'ab'.repeat(32);
  assert.equal(parsePrivateKey(k), `0x${k}`);
  assert.equal(parsePrivateKey(`0x${k.toUpperCase()}`), `0x${k}`);
  assert.equal(parsePrivateKey('0x12'), null);
  assert.equal(parsePrivateKey('hello'), null);
});
test('word counts of 12 to 24 in steps of three are accepted', () => {
  assert.equal(wordCountOk(new Array(15).fill('a').join(' ')), true);
  assert.equal(wordCountOk(new Array(13).fill('a').join(' ')), false);
});
test('empty addresses and the wallet\'s own are dropped', () => {
  const h = (n: bigint) => [{ net: 'sepolia', symbol: 'ETH', decimals: 18, amount: n }];
  const f: FoundAddress[] = [
    { from: 'a', style: 'metamask', address: '0xAAA', holdings: h(5n) },
    { from: 'b', style: 'ledger', address: '0xBBB', holdings: h(0n) },
    { from: 'c', style: 'metamask', address: '0xCCC', holdings: h(7n) },
  ];
  assert.deepEqual(onlyWithMoney(f, ['0xaaa']).map((x) => x.address), ['0xCCC']);
});
