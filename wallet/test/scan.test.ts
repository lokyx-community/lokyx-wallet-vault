import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayload } from '../src/lib/scan-core.ts';
import { btcKey, ethKey } from '../src/lib/multichain-core.ts';
import { addressFromPrivateKey, deriveKey } from '../src/lib/lokyx.ts';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

test('scan: Bitcoin QR codes (bare signet/testnet/mainnet address and bitcoin: URI with amount)', () => {
  for (const net of ['signet', 'mainnet'] as const) {
    const a = btcKey(phrase, net).address;
    assert.deepEqual(parsePayload(a), { address: a, how: 'qr', chain: 'btc', amount: undefined });
  }
  const tb = btcKey(phrase, 'signet').address;
  assert.deepEqual(parsePayload(`bitcoin:${tb}?amount=0.015&label=x`), { address: tb, how: 'qr', chain: 'btc', amount: '0.015' });
  assert.equal(parsePayload(`bitcoin:${tb.slice(0, -1)}x`), null);
});

test('scan: Ethereum QR codes (bare, ethereum:, with chain id and EIP-681 path)', () => {
  const a = ethKey(phrase).address;
  for (const t of [a, a.toLowerCase(), `ethereum:${a}`, `ethereum:${a}@11155111`]) {
    assert.deepEqual(parsePayload(t), { address: a.startsWith('0x') && t.includes(a) ? a : a.toLowerCase(), how: 'qr', chain: 'eth' }, t);
  }
  // EIP-681 value is in wei
  assert.deepEqual(parsePayload(`ethereum:pay-${a}@1?value=1e18`), { address: a, how: 'qr', chain: 'eth', amount: '1' });
  // a wrong checksum (mixed case that doesn't match) is refused
  const bad = a.slice(0, 2) + a.slice(2).split('').map((c, i) => (i === 3 && /[a-f]/.test(c) ? c.toUpperCase() : i === 3 && /[A-F]/.test(c) ? c.toLowerCase() : c)).join('');
  if (bad !== a) assert.equal(parsePayload(bad), null);
});

test('scan: LOKYX addresses and links still work, junk is ignored', () => {
  const lyx = addressFromPrivateKey(deriveKey(phrase, 0));
  assert.deepEqual(parsePayload(lyx), { address: lyx, how: 'qr' });
  assert.deepEqual(parsePayload(`https://testnet.lokyx.xyz/pay/${lyx}?amount=2.5`), { address: lyx, how: 'qr', amount: '2.5' });
  // what the Receive screen's QR code says, and what a QR reader may hand back in capitals
  assert.deepEqual(parsePayload(`lokyx:${lyx}`), { address: lyx, how: 'qr', amount: undefined });
  assert.deepEqual(parsePayload(`lokyx:${lyx}?amount=3`), { address: lyx, how: 'qr', amount: '3' });
  assert.deepEqual(parsePayload(lyx.toUpperCase()), { address: lyx, how: 'qr' });
  assert.equal(parsePayload('hello'), null);
  assert.equal(parsePayload('https://example.com'), null);
});

import { requestUri, weiToEth } from '../src/lib/scan-core.ts';

test('payment requests for Bitcoin and Ethereum round-trip through the scanner', () => {
  const btc = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
  const b = parsePayload(requestUri('btc', btc, '0.0021'));
  assert.equal(b?.chain, 'btc');
  assert.equal(b?.amount, '0.0021');
  const eth = '0x4b1e2f0000000000000000000000000000009c07';
  const u = requestUri('eth', eth, '1.25', 11155111);
  assert.equal(u, `ethereum:${eth}@11155111?value=1250000000000000000`);
  const e = parsePayload(u);
  assert.equal(e?.chain, 'eth');
  assert.equal(e?.amount, '1.25');
  assert.equal(weiToEth('1.5e18'), '1.5');
  assert.equal(parsePayload(`ethereum:${eth}/transfer?address=0x00&uint256=5`)?.amount, undefined);
});

test('plain tron and solana addresses are read as payments', () => {
  assert.equal(parsePayload('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')?.chain, 'trx');
  assert.equal(parsePayload('So11111111111111111111111111111111111111112')?.chain, 'sol');
});
