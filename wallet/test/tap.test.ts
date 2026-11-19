import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapRequest, tapProblem, tapTokenRequest, tapAsk, TAP_RSSI } from '../src/lib/tap-core.ts';
import { parsePayload } from '../src/lib/scan-core.ts';
import { requestUri, tokenRequestUri } from '../src/lib/scan-core.ts';
import { btcKey, ethKey } from '../src/lib/multichain-core.ts';
import { addressFromPrivateKey, deriveKey } from '../src/lib/lokyx.ts';

const phrase = 'abandon '.repeat(23) + 'art';
const generate = () => addressFromPrivateKey(deriveKey(phrase));

test('a tapped request is read exactly like a QR code', () => {
  const addr = generate();
  assert.equal(parsePayload(tapRequest(addr))?.address, addr);
  const f = parsePayload(tapRequest(addr, '2.5'));
  assert.equal(f?.amount, '2.5');
  assert.equal(f?.address, addr);
});

test('every failure has words a person can act on', () => {
  for (const r of ['permission', 'off', 'unsupported', 'timeout', 'lost', 'payload', 'advertise:3']) assert.ok(tapProblem(r).length > 10);
  assert.ok(TAP_RSSI < 0 && TAP_RSSI > -80);
});

test('tapping works for every coin: Bitcoin, Ether and tokens, with or without an amount', () => {
  const btc = btcKey(phrase, 'signet').address;
  const eth = ethKey(phrase).address;
  const usdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  assert.equal(parsePayload(requestUri('btc', btc))?.chain, 'btc');
  assert.equal(parsePayload(requestUri('btc', btc, '0.01'))?.amount, '0.01');
  assert.equal(parsePayload(requestUri('eth', eth))?.chain, 'eth');
  const t = parsePayload(tapTokenRequest(usdc, eth, 11155111));
  assert.equal(t?.token, usdc);
  assert.equal(t?.address, eth);
  assert.equal(t?.units, undefined);
  const t2 = parsePayload(tokenRequestUri({ contract: usdc, decimals: 6, to: eth, amount: '2.5', chainId: 11155111 }));
  assert.equal(t2?.units, '2500000');
  assert.ok(new TextEncoder().encode(tapTokenRequest(usdc, eth, 11155111)).length < 400);
});

test('the sender sees what is being asked for', () => {
  assert.equal(tapAsk({ amount: '5' }), '5 LYX');
  assert.equal(tapAsk({ chain: 'btc' }), 'BTC');
  assert.equal(tapAsk({ chain: 'eth', token: '0xabc' }, 'USDC'), 'USDC');
});
