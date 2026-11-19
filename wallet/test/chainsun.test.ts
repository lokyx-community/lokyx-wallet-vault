import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainToSun, sunToChain, TYPE_BTC, TYPE_BTC_TEST, TYPE_ETH } from '../src/lib/chain-sun.ts';
import { sunLevels, sunPaths, RAYS } from '../src/lib/sun.ts';
import { fillTarget } from '../src/lib/sunfill-core.ts';

const BTC_MAIN = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_TEST = 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl';
const ETH = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

test('bitcoin and ethereum addresses round trip through the sun payload', () => {
  for (const [chain, a, type] of [['btc', BTC_MAIN, TYPE_BTC], ['btc', BTC_TEST, TYPE_BTC_TEST], ['eth', ETH, TYPE_ETH]] as const) {
    const s = chainToSun(chain, a)!;
    assert.equal(s.type, type);
    assert.equal(s.bytes.length, 20);
    assert.deepEqual(sunToChain(s.type, s.bytes), { chain, address: a });
  }
  // lowercase ETH comes back checksummed
  assert.equal(sunToChain(TYPE_ETH, chainToSun('eth', ETH.toLowerCase())!.bytes)!.address, ETH);
});

test('addresses that do not fit a 20-byte sun are refused, not truncated', () => {
  // taproot (witness v1, 32 bytes) and P2WSH (32 bytes)
  assert.equal(chainToSun('btc', 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'), null);
  assert.equal(chainToSun('btc', 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'), null);
  assert.equal(chainToSun('eth', '0x1234'), null);
  assert.equal(chainToSun('btc', 'lyx1qphtkj8re77ltkzw8lu9yy90rx9sj88jvvnrlkkf'), null);
  assert.equal(sunToChain(1, new Uint8Array(20)), null); // a LYX sun is not a foreign address
});

test('chain types give a different sun from the same bytes, and draw a full set of rays', () => {
  const s = chainToSun('eth', ETH)!;
  const a = sunLevels(s.bytes, TYPE_ETH);
  const b = sunLevels(s.bytes, 1);
  assert.notDeepEqual(a, b);
  assert.equal(sunPaths(a, 300).each.length, RAYS);
});

test('the sun only fills completely once the payment is in a block', () => {
  const n = 84;
  const order = ['signing', 'sending', 'waiting', 'done'] as const;
  const t = order.map((s) => fillTarget(s, n));
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
  assert.ok(fillTarget('waiting', n) < n);
  assert.equal(fillTarget('done', n), n);
  assert.equal(fillTarget('failed', n), 0);
});

test('a tron address round trips through the sun, and solana is refused', () => {
  const T = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const s = chainToSun('trx', T)!;
  assert.equal(s.bytes.length, 20);
  assert.deepEqual(sunToChain(s.type, s.bytes), { chain: 'trx', address: T });
  assert.equal(chainToSun('trx', ETH), null);
});

test('a solana address round trips through the wide sun payload', () => {
  const A = 'So11111111111111111111111111111111111111112';
  const s = chainToSun('sol', A)!;
  assert.equal(s.bytes.length, 32);
  assert.deepEqual(sunToChain(s.type, s.bytes), { chain: 'sol', address: A });
  assert.equal(sunPaths(sunLevels(s.bytes, s.type), 300).each.length, 128);
});
