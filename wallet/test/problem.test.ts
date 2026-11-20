import test from 'node:test';
import assert from 'node:assert/strict';
import { problemFrom, faucetFor, cardFor } from '../src/lib/problem-core.ts';

const ids = (p: NonNullable<ReturnType<typeof problemFrom>>) => p.options.map((o) => o.id);

test('a person who cancelled on purpose sees nothing', () => {
  assert.equal(problemFrom(new Error('user rejected the request')), null);
});

test('offline and busy say what to do, and offer to try again', () => {
  const off = problemFrom(new Error('Network request failed'), { where: 'Base Sepolia' })!;
  assert.equal(off.kind, 'offline');
  assert.match(off.body, /Base Sepolia/);
  assert.deepEqual(ids(off), ['retry', 'close']);
  const busy = problemFrom(new Error('The Ethereum node answered 429'), { where: 'the network' })!;
  assert.equal(busy.kind, 'busy');
  assert.equal(busy.options[0].main, true);
});

test('no fee money: offers the faucet only where a real one is known, plus copying the address', () => {
  const bnb = problemFrom(new Error('insufficient funds for gas * price + value'), { where: 'BNB Chain testnet', symbol: 'BNB' })!;
  assert.equal(bnb.kind, 'funds');
  assert.deepEqual(ids(bnb), ['retry', 'faucet', 'copy-address', 'close']);
  assert.match(bnb.title, /BNB/);
  const other = problemFrom(new Error('insufficient funds'), { where: 'Base Sepolia', symbol: 'ETH' })!;
  assert.ok(!ids(other).includes('faucet'));
  assert.equal(faucetFor('Base Sepolia'), null);
  assert.match(faucetFor('BNB Chain testnet')!, /^https:\/\//);
  const own = problemFrom(new Error('Your everyday address 0xabc has no test BNB on BNB Chain testnet. Get some from a faucet first'), { where: 'BNB Chain testnet', symbol: 'BNB' })!;
  assert.equal(own.kind, 'funds');
});

test('a vault that failed its own check is not called fine, and can be checked again', () => {
  const p = problemFrom(new Error('The vault was created but does not look right: the delay is wrong. Do not put money in it.'))!;
  assert.equal(p.kind, 'needs-check');
  assert.deepEqual(ids(p), ['check-again', 'copy-details', 'close']);
  assert.match(p.body, /Do not put money/);
});

test('a refusal from the network keeps the reason and keeps the details for support', () => {
  const p = problemFrom(new Error('execution reverted: TakenAddress'), { where: 'BNB Chain testnet' })!;
  assert.equal(p.kind, 'refused');
  assert.match(p.body, /takenAddress/i);
  assert.match(p.details, /execution reverted/);
  assert.ok(ids(p).includes('copy-details'));
});

test('anything else is shortened, never a wall of text, and always offers a way forward', () => {
  const long = 'x'.repeat(900);
  const p = problemFrom(new Error(long))!;
  assert.equal(p.kind, 'other');
  assert.ok(p.body.length <= 240);
  assert.equal(p.details.length, 900);
  assert.ok(ids(p).includes('retry'));
  assert.ok(problemFrom('')!.title.length > 0);
});

test('every problem has exactly one main action', () => {
  for (const e of ['Network request failed', 'insufficient funds', 'nonce too low', 'execution reverted', 'boom', 'created but does not look right']) {
    const p = problemFrom(new Error(e))!;
    assert.equal(p.options.filter((o) => o.main).length, 1, e);
  }
});

test('the pop-up card names the kind of trouble, and falls back to a plain title', () => {
  assert.equal(cardFor('Network request failed').title, 'No connection');
  assert.equal(cardFor('Network request failed').tone, 'wait');
  assert.equal(cardFor('The chain said something odd').title, "That didn't work");
  assert.equal(cardFor('The chain said something odd').tone, 'bad');
});
