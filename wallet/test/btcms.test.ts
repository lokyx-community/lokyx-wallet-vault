import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as btc from '@scure/btc-signer';
import { draftSpend, finishSpend, msAddress, msKey, parseKey, readSpend, signSpend, type BtcShared } from '../src/lib/btcms-core.ts';

const W = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
  'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless',
];

test('2-of-3 Bitcoin: same address for everyone, pays only with two signatures', () => {
  const ks = W.map((w) => msKey(w, 'testnet4'));
  const s: BtcShared = { name: 'Family', net: 'testnet4', m: 2, keys: ks.map((k) => k.pub) };
  const addr = msAddress(s);
  assert.match(addr, /^tb1q[0-9a-z]{58}$/); // P2WSH: 32-byte program
  assert.equal(msAddress({ ...s, keys: [...s.keys].reverse() }), addr); // order doesn't matter
  assert.equal(parseKey(`lokyx-btckey:${ks[0].pub}`), ks[0].pub);

  const utxos = [{ txid: 'aa'.repeat(32), vout: 0, value: 100_000n }, { txid: 'bb'.repeat(32), vout: 1, value: 50_000n }];
  const to = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
  const d = draftSpend(s, utxos, to, 60_000n, 2);
  let r = readSpend(s, d.psbt);
  assert.deepEqual(r.pays, [{ to, amount: 60_000n }]);
  assert.equal(r.fee, d.fee);
  assert.equal(r.signatures, 0);
  assert.throws(() => finishSpend(s, d.psbt), /2 more signatures/);

  const one = signSpend(s, d.psbt, ks[0].sk);
  r = readSpend(s, one);
  assert.equal(r.signatures, 1);
  assert.ok(r.signedByKey(ks[0].pub));
  assert.ok(!r.signedByKey(ks[1].pub));
  assert.throws(() => finishSpend(s, one), /1 more signature/);

  const two = signSpend(s, one, ks[2].sk);
  assert.ok(readSpend(s, two).ready);
  const { hex, txid } = finishSpend(s, two);
  const tx = btc.Transaction.fromRaw(Buffer.from(hex, 'hex'));
  assert.equal(tx.id, txid);
  assert.equal(tx.inputsLength, 2);

  // a code for another account is refused
  const other: BtcShared = { ...s, m: 3 };
  assert.throws(() => readSpend(other, d.psbt), /different account/);
});
