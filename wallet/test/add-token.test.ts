import test from 'node:test';
import assert from 'node:assert/strict';
import { asChain, canAdd, cardKindFor, guessChain, shortId, verdictFor } from '../src/lib/add-token-core.ts';

test('an address says which network it is on', () => {
  assert.equal(guessChain('0xdAC17F958D2ee523a2206206994597C13D831ec7'), 'eth');
  assert.equal(guessChain('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), 'trx');
  assert.equal(guessChain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 'sol');
  assert.equal(guessChain('lyx1qqqqqqqqqqqqqqqq'), 'lyx');
  assert.equal(guessChain('  0xdAC17F958D2ee523a2206206994597C13D831ec7 '), 'eth');
  assert.equal(guessChain('hello'), null);
  assert.equal(guessChain('0x1234'), null);
});

test('unknown tokens need a tick, known ones do not', () => {
  assert.equal(canAdd(false, null, true), false);
  assert.equal(canAdd(true, null, false), false);
  assert.equal(canAdd(true, null, true), true);
  assert.equal(canAdd(true, 'Tether', false), true);
});

test('verdicts and card colours', () => {
  assert.equal(verdictFor('Tether').tone, 'good');
  assert.equal(verdictFor(null).tone, 'warn');
  assert.equal(cardKindFor('Tether', 'USDT'), 'usdt');
  assert.equal(cardKindFor('USD Coin', 'usdc'), 'usdc');
  assert.equal(cardKindFor('Dai', 'DAI'), 'gr');
  assert.equal(cardKindFor(null, 'USDC'), 'gr');
});

test('small helpers', () => {
  assert.equal(asChain('sol'), 'sol');
  assert.equal(asChain('nope'), 'eth');
  assert.equal(shortId('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'), '9xQe…VFin');
  assert.equal(shortId('short'), 'short');
});

import { BLOCKCHAINS, searchChains } from '../src/lib/blockchains-core.ts';

test('a copy of a known coin is called out', () => {
  const v = verdictFor(null, 'USD Coin');
  assert.equal(v.tone, 'bad');
  assert.match(v.title, /USD Coin/);
  assert.equal(verdictFor('Tether', 'Tether').tone, 'good');
});

test('blockchain search finds by the start of a word', () => {
  assert.equal(searchChains('').length, BLOCKCHAINS.length);
  assert.deepEqual(searchChains('mon').map((b) => b.id), ['xmr']);
  assert.deepEqual(searchChains('bit').map((b) => b.id), ['bch']);
  assert.equal(searchChains('zzz').length, 0);
});
