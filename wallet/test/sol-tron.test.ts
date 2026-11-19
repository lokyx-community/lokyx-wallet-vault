import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { base58 } from '@scure/base';
import { parseSol, signSolTransfer, solAddressOk, solDelta, solKeyFromSeed } from '../src/lib/sol-core.ts';
import { parseTronTxs, parseTrx, signTronTransfer, transferRaw, tronAddressOk, tronHex, tronKey } from '../src/lib/tron-core.ts';

// Expected values come from the reference libraries (@solana/web3.js 1.98 with ed25519-hd-key, and TronWeb 6.0.3),
// run outside the app on the same words. Signatures are deterministic, so whole transactions can be compared.
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = mnemonicToSeedSync(WORDS);
const root = HDKey.fromMasterSeed(seed);

test('solana: same addresses as Phantom and @solana/web3.js for the same words', () => {
  assert.equal(solKeyFromSeed(seed, 0).address, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  assert.equal(solKeyFromSeed(seed, 1).address, 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb');
});

test('solana: a transfer is byte for byte what @solana/web3.js makes', () => {
  const a = solKeyFromSeed(seed, 0);
  const b = solKeyFromSeed(seed, 1);
  const tx = signSolTransfer(a.sk, a.address, b.address, 123456789n, 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
  assert.equal(
    tx.b64,
    'AdFpjNroFywWZ/YLHD2+b9SSbYMXQVcj2uvwxaChi/Hu7XKM2lQU2SslSWkal5+mMMs3KTVcxzvO4+kPTN9kfAkBAAED8DYnYkanW53jNJ7UKxXiMvZRj8IPX81PHWToH5vSWPf4AprPXLy91axG7BR/O3ij325QIu8EEdsrq2UNMppM1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzEkOkozS44c7s0P8ldozF5ymD02/RsLDbpEpnVXU5rkBAgIAAQwCAAAAFc1bBwAAAAA=',
  );
  assert.equal(base58.decode(tx.id).length, 64);
});

test('solana: refuses a wrong key, its own address, zero, and bad addresses', () => {
  const a = solKeyFromSeed(seed, 0);
  const b = solKeyFromSeed(seed, 1);
  const bh = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
  assert.throws(() => signSolTransfer(b.sk, a.address, b.address, 1n, bh), /not for that address/);
  assert.throws(() => signSolTransfer(a.sk, a.address, a.address, 1n, bh), /own address/);
  assert.throws(() => signSolTransfer(a.sk, a.address, b.address, 0n, bh), /amount/);
  assert.equal(solAddressOk(a.address), true);
  assert.equal(solAddressOk('0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0'), false);
  assert.equal(solAddressOk(a.address.slice(0, -1) + 'O'), false); // O is not base58
  assert.equal(parseSol('1.5'), 1_500_000_000n);
  assert.equal(parseSol('0.000000001'), 1n);
  assert.throws(() => parseSol('0.0000000001'));
});

test('solana: history reads the change to this address only', () => {
  const me = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
  const tx = { meta: { preBalances: [5_000_000_000, 0, 1], postBalances: [3_999_995_000, 1_000_000_000, 1] }, transaction: { message: { accountKeys: [{ pubkey: me }, { pubkey: 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb' }, '11111111111111111111111111111111'] } } };
  assert.equal(solDelta(tx, me), -1_000_005_000n);
  assert.equal(solDelta(tx, 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb'), 1_000_000_000n);
  assert.equal(solDelta(tx, 'nobody'), null);
});

test('tron: same addresses as TronLink and TronWeb for the same words', () => {
  assert.equal(tronKey(root, 0).address, 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
  assert.equal(tronKey(root, 1).address, 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK');
  assert.equal(tronAddressOk('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'), true);
  assert.equal(tronAddressOk('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdh'), false); // checksum
  assert.equal(tronAddressOk('0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0'), false);
});

test('tron: the transaction, its id and its signature match TronWeb', () => {
  const a = tronKey(root, 0);
  const b = tronKey(root, 1);
  const ref = { number: 0x030dc507, id: '00000000030dc5076a3a6f1d6d4ed2a0b5f7c4b9c0a1e2d3f4a5b6c7d8e9f0a1', timestamp: 1763290000000 };
  const now = 1763290012345;
  const raw = transferRaw(a.address, b.address, 1_500_000n, ref, now);
  assert.equal(
    Buffer.from(raw).toString('hex').toUpperCase(),
    '0A02C50722086A3A6F1D6D4ED2A040C0A4BDE2A8335A67080112630A2D747970652E676F6F676C65617069732E636F6D2F70726F746F636F6C2E5472616E73666572436F6E747261637412320A1541C8599111F29C1E1E061265B4AF93EA1F274AD78A121541B6E708A39781C96BD399C7657780FF9FE9F052A818E0C65B70B9B599E2A833',
  );
  const s = signTronTransfer(a.sk, a.address, b.address, 1_500_000n, ref, now);
  assert.equal(s.id, 'cfabe1311c1895611bc2699610f2ce5da03f8d1b5046273bb3b05a2cbd7323cf');
  const sig = '63286e9281c5dac749e1260178411530afd691b16aabc53314f8b265f0fbbbe5519a3dc59e236b237e2c6b364795fa2eb2765d5a07b7faef9890ebd595f6e3441c';
  assert.ok(s.hex.endsWith(sig), 'signature');
  assert.ok(s.hex.startsWith('0a' + raw.length.toString(16)), 'raw data first');
  assert.throws(() => signTronTransfer(b.sk, a.address, b.address, 1n, ref, now), /not for that address/);
  assert.throws(() => transferRaw(a.address, a.address, 1n, ref, now), /own address/);
  assert.equal(parseTrx('1.5'), 1_500_000n);
  assert.throws(() => parseTrx('0.0000001'));
});

test('tron: history keeps TRX transfers to or from this address', () => {
  const me = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
  const other = 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK';
  const t = (from: string, to: string, amount: number, ok = true, type = 'TransferContract') => ({
    txID: `${from.slice(1, 5)}${to.slice(1, 5)}${amount}`,
    block_timestamp: 1763290000000,
    ret: [{ contractRet: ok ? 'SUCCESS' : 'REVERT' }],
    raw_data: { contract: [{ type, parameter: { value: { owner_address: tronHex(from), to_address: tronHex(to), amount } } }] },
  });
  const rows = parseTronTxs({ data: [t(other, me, 5_000_000), t(me, other, 1_000_000, false), t(me, other, 7, true, 'TriggerSmartContract')] }, me);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].delta, rows[0].other, rows[0].failed], [5_000_000n, other, false]);
  assert.deepEqual([rows[1].delta, rows[1].failed], [-1_000_000n, true]);
});

test('solana and tron: no real money while the setting is off', async () => {
  const { assertAllowedX } = await import('../src/lib/xchains-core.ts');
  const { DEFAULT_CHAIN_SETTINGS } = await import('../src/lib/multichain-core.ts');
  assert.throws(() => assertAllowedX(DEFAULT_CHAIN_SETTINGS, 'sol', 'mainnet'), /turned off/);
  assert.throws(() => assertAllowedX(DEFAULT_CHAIN_SETTINGS, 'trx', 'mainnet'), /turned off/);
  assertAllowedX(DEFAULT_CHAIN_SETTINGS, 'sol', 'devnet');
  assertAllowedX(DEFAULT_CHAIN_SETTINGS, 'trx', 'nile');
  assertAllowedX({ ...DEFAULT_CHAIN_SETTINGS, allowMainnet: true }, 'sol', 'mainnet');
});

test('one seed gives every address, and the new ones match the reference', async () => {
  const { allAddresses } = await import('../src/lib/multichain-core.ts');
  const a = allAddresses(WORDS);
  assert.equal(a.sol, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  assert.equal(a.trx, 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
  assert.equal(a.eth, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'); // unchanged
});
