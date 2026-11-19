import test from 'node:test';
import assert from 'node:assert/strict';
import { feeFromLines, slipRows, slipText } from '../src/lib/slip-core.ts';

const base = { amount: '0.015', unit: 'ETH', to: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', network: 'Sepolia', at: new Date(2026, 10, 18, 12, 41).getTime(), hash: '0x9f3a000000000000000000000000000000000000000000000000000000c21d' };

test('fee comes out of the plain-language line', () => {
  assert.equal(feeFromLines(['Send 1 BTC', 'Network fee: 0.00001 BTC (5 sat/vB, about 140 vbytes).']), '0.00001 BTC');
  assert.equal(feeFromLines(['Network fee: up to 0.00008 ETH (max 2 gwei, tip 1 gwei).']), 'up to 0.00008 ETH');
  assert.equal(feeFromLines(['Network fee: 0.000005 SOL']), '0.000005 SOL');
  assert.equal(feeFromLines(['Send 1 TRX']), undefined);
});

test('rows are in order and skip what is missing', () => {
  const r = slipRows(base);
  assert.deepEqual(r.map((x) => x.label), ['To', 'Network', 'Time']);
  assert.equal(r[2].value, '18 Nov 2026, 12:41');
  const full = slipRows({ ...base, from: '0x0369aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6697', fromName: 'Main', toName: 'Asha', fee: '0.00008 ETH' });
  assert.deepEqual(full.map((x) => x.label), ['To', 'From', 'Network', 'Fee', 'Time']);
  assert.match(full[0].value, /^Asha · /);
});

test('shared text keeps the full address and transaction id', () => {
  const t = slipText({ ...base, testnet: true });
  assert.ok(t.includes(base.to) && t.includes(base.hash));
  assert.ok(t.startsWith('Sent 0.015 ETH'));
  assert.ok(t.includes('Test network'));
});

import { receiptText } from '../src/lib/slip-core.ts';
test('history receipt text', () => {
  const t = receiptText('Sent 1000 TRX', [['To', 'TLxs2gJfa7N6JA9nX3'], ['Network', 'Tron Nile']], 'abc123', 'https://x.test/tx/abc123', 'Test network, no market value');
  assert.equal(t.split('\n')[0], 'Sent 1000 TRX');
  assert.ok(t.includes('To: TLxs2gJfa7N6JA9nX3') && t.includes('Transaction: abc123') && t.includes('https://x.test/tx/abc123'));
});

import { b64ToBytes, receiptImage, tornPath } from '../src/lib/slip-core.ts';

test('base64 decodes, with or without padding and a data prefix', () => {
  assert.deepEqual([...b64ToBytes('SGVsbG8=')], [72, 101, 108, 108, 111]);
  assert.deepEqual([...b64ToBytes('data:image/png;base64,SGVsbG8')], [72, 101, 108, 108, 111]);
  assert.throws(() => b64ToBytes('@@'));
});

test('the receipt picture lays out in order and stays inside the paper', () => {
  const a = receiptImage({ ...base, from: '0x0369aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6697', fee: '0.00008 ETH', testnet: true }, true);
  assert.equal(a.width, 390);
  const texts = a.items.filter((i) => i.k === 'text').map((i) => (i as { s: string }).s);
  assert.ok(texts.includes('Sent') && texts.includes('0.015 ETH') && texts.includes('Confirmed on Sepolia'));
  assert.ok(texts.some((t) => t.includes('test network')));
  const w = receiptImage(base, false);
  assert.ok(w.items.some((i) => i.k === 'text' && i.s === 'On its way'));
  assert.ok(w.height > 300 && a.height > w.height - 1);
  for (const i of a.items) if (i.k === 'text') assert.ok(i.y > 0 && i.y < a.height);
});

test('the torn edge is one closed zigzag that ends where it began', () => {
  const d = tornPath(24, 500, 342);
  assert.ok(d.startsWith('M24 500') && d.endsWith('Z'));
  assert.ok(d.includes('L366 500'));
});
