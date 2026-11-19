import test from 'node:test';
import assert from 'node:assert/strict';
import { allAddresses, btcPath, ethKey, ethPath } from '../src/lib/multichain-core.ts';
import { tronPath } from '../src/lib/tron-core.ts';

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('account 0 keeps the paths the wallet always used', () => {
  assert.equal(ethPath(0), "m/44'/60'/0'/0/0");
  assert.equal(ethPath(1), "m/44'/60'/0'/0/1");
  assert.equal(btcPath('mainnet', 0), "m/84'/0'/0'/0/0");
  assert.equal(tronPath(0), "m/44'/195'/0'/0/0");
});

test('another account moves the account level, so the Apps wallet address (index 1) is never reused', () => {
  assert.equal(ethPath(0, 2), "m/44'/60'/2'/0/0");
  assert.equal(btcPath('signet', 0, 1), "m/84'/1'/1'/0/0");
  assert.equal(tronPath(0, 3), "m/44'/195'/3'/0/0");
});

test('each account has its own address on every coin, and account 0 is the same as before', () => {
  const a0 = allAddresses(WORDS);
  assert.deepEqual(allAddresses(WORDS, 0), a0);
  const a1 = allAddresses(WORDS, 1);
  assert.notEqual(a1.eth, a0.eth);
  assert.notEqual(a1.btc.mainnet, a0.btc.mainnet);
  assert.notEqual(a1.sol, a0.sol);
  assert.notEqual(a1.trx, a0.trx);
  const apps = ethKey(WORDS, 1);
  apps.sk.fill(0);
  assert.notEqual(a1.eth, apps.address);
  assert.equal(ethKey(WORDS, 0, 1).address, a1.eth);
});
