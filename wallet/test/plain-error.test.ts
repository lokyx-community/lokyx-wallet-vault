import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainError } from '../src/lib/plain-error.ts';

test('plain errors: a dead connection says so, with the network named', () => {
  const e = new Error('fetch failed: java.net.UnknownHostException: Unable to resolve host "sepolia.base.org": No address associated with hostname');
  assert.equal(plainError(e, 'Base Sepolia'), "Can't reach Base Sepolia right now. Check your connection and try again.");
  assert.equal(plainError(new Error('Network request failed')), "Can't reach the network right now. Check your connection and try again.");
});

test('plain errors: an empty vault is explained, not quoted from the contract', () => {
  assert.equal(plainError(new Error('execution reverted: Could not execute ether transfer')), "The vault doesn't hold enough ETH for that. Send some to the vault address first.");
  assert.match(plainError(new Error('insufficient funds for gas * price + value')), /enough ETH to pay the network fee/);
});

test('plain errors: our own sentences pass through, unknown reverts are softened', () => {
  assert.equal(plainError(new Error('Those 12 words do not check out.')), 'Those 12 words do not check out.');
  assert.equal(plainError(new Error('execution reverted: GS013')), 'The network turned it down: GS013.');
  assert.equal(plainError(new Error('execution reverted')), 'The network turned it down.');
  assert.equal(plainError(''), 'Something went wrong. Try again.');
});
