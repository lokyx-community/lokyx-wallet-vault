import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { recoverTransactionAddress, parseTransaction, decodeFunctionData } from 'viem';
import {
  btcKey, ethKey, btcPath, ethPath, planBtc, signBtc, pickFeeRates, lookalike, parseBtc, formatBtc, effective, assertAllowed,
  DEFAULT_CHAIN_SETTINGS, ethAddressOk, ethFeeChoices, signEth, ERC20_ABI, KNOWN_TOKENS, tokenId, describeBtc, describeEth, parseUnits, formatUnits, btcAddressOk, ETH_NETS,
} from '../src/lib/multichain-core.ts';

// BIP39 test mnemonic. Its first BIP84 address and first Ethereum address are published reference values.
const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('BIP84 mainnet vector: m/84\'/0\'/0\'/0/0 is bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', () => {
  assert.equal(btcKey(M, 'mainnet', 0).address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(btcKey(M, 'mainnet', 1).address, 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
});

test('BIP84 test networks use coin type 1 and a tb1 address', () => {
  assert.equal(btcPath('signet', 3), "m/84'/1'/0'/0/3");
  assert.equal(btcPath('mainnet', 0), "m/84'/0'/0'/0/0");
  assert.equal(btcKey(M, 'testnet', 0).address, 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
  assert.equal(btcKey(M, 'signet', 0).address, btcKey(M, 'testnet', 0).address);
});

test('Ethereum m/44\'/60\'/0\'/0/0 for the test mnemonic is 0x9858EfFD…Eda94', () => {
  assert.equal(ethKey(M, 0).address, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  assert.equal(ethPath(2), "m/44'/60'/0'/0/2");
  assert.equal(ethKey(M, 1).address, '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
});

test('bitcoin amounts and addresses', () => {
  assert.equal(parseBtc('0.001'), 100_000n);
  assert.equal(formatBtc(123_456_789n), '1.23456789');
  assert.throws(() => parseBtc('0.123456789'));
  assert.ok(btcAddressOk('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', 'signet'));
  assert.ok(!btcAddressOk('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'signet'), 'a mainnet address on a test network');
  assert.ok(!btcAddressOk('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkx', 'signet'), 'bad checksum');
});

const utxo = (txid: string, value: bigint, vout = 0) => ({ txid, vout, value });
const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64), T3 = 'c'.repeat(64);

test('coin selection: largest first, change returned, fee = rate x size', () => {
  const p = planBtc([utxo(T1, 10_000n), utxo(T2, 50_000n), utxo(T3, 20_000n)], 30_000n, 10);
  assert.deepEqual(p.inputs.map((i) => i.txid), [T2]);
  assert.equal(p.fee, 141n * 10n); // 141 vbytes for 1 input and 2 outputs, rounded up, at 10 sat/vB
  assert.equal(p.change, 50_000n - 30_000n - p.fee);
  assert.equal(p.change + p.fee + p.amount, 50_000n);
});

test('coin selection: dust change goes to the miners, and too little is refused', () => {
  const p = planBtc([utxo(T1, 30_200n)], 30_000n, 1);
  assert.equal(p.change, 0n);
  assert.equal(p.fee, 200n);
  assert.throws(() => planBtc([utxo(T1, 1_000n)], 30_000n, 5), /enough/);
  assert.throws(() => planBtc([utxo(T1, 1_000n)], 100n, 5), /minimum/);
});

test('a signed Bitcoin transaction pays the right outputs and its signature verifies', () => {
  const k = btcKey(M, 'signet', 0);
  const dest = btcKey(M, 'signet', 1).address;
  const s = signBtc({ sk: k.sk, from: k.address, to: dest, net: 'signet', utxos: [utxo(T1, 100_000n, 1)], amount: 40_000n, rate: 5 });
  const tx = btc.Transaction.fromRaw(Buffer.from(s.hex, 'hex'));
  assert.equal(tx.inputsLength, 1);
  assert.equal(tx.outputsLength, 2);
  const outs = [0, 1].map((i) => tx.getOutput(i));
  const sum = outs.reduce((a, o) => a + (o.amount ?? 0n), 0n);
  assert.equal(sum + s.plan.fee, 100_000n);
  assert.equal(btc.Address(btc.TEST_NETWORK).encode(btc.OutScript.decode(outs[0].script!)), dest);
  assert.equal(outs[0].amount, 40_000n);
  // verify the ECDSA signature over the BIP143 digest
  const inp = tx.getInput(0);
  const [sig, pub] = inp.finalScriptWitness!;
  const spend = btc.p2wpkh(secp256k1.getPublicKey(k.sk, true), btc.TEST_NETWORK);
  const digest = tx.preimageWitnessV0(0, btc.p2pkh(pub).script, btc.SigHash.ALL, 100_000n);
  assert.ok(secp256k1.verify(sig.slice(0, -1), digest, pub, { prehash: false, format: 'der' }), 'the signature must verify against the BIP143 digest');
  assert.ok(!secp256k1.verify(sig.slice(0, -1), new Uint8Array(32).fill(7), pub, { prehash: false, format: 'der' }), 'and not against anything else');
  assert.equal(sig[sig.length - 1], btc.SigHash.ALL);
  assert.equal(bytesToHex(pub), bytesToHex(secp256k1.getPublicKey(k.sk, true)));
});

test('a key that is not the sender, or a mainnet address on signet, is refused', () => {
  const k = btcKey(M, 'signet', 0);
  assert.throws(() => signBtc({ sk: btcKey(M, 'signet', 5).sk, from: k.address, to: k.address, net: 'signet', utxos: [utxo(T1, 100_000n)], amount: 1_000n, rate: 1 }), /does not match/);
  assert.throws(() => signBtc({ sk: k.sk, from: k.address, to: btcKey(M, 'mainnet', 0).address, net: 'signet', utxos: [utxo(T1, 100_000n)], amount: 1_000n, rate: 1 }), /not a valid/);
});

test('fee choices from Esplora estimates', () => {
  const r = pickFeeRates({ '1': 30.2, '2': 25, '3': 12, '6': 8, '12': 3, '144': 1 });
  assert.deepEqual(r, { fast: 31, normal: 12, slow: 3 });
  assert.deepEqual(pickFeeRates({}), { fast: 1, normal: 1, slow: 1 });
});

test('mainnet stays off unless allowed', () => {
  assert.deepEqual(effective({ ...DEFAULT_CHAIN_SETTINGS, btcNet: 'mainnet', ethNet: 'mainnet', solNet: 'mainnet', tronNet: 'mainnet' }), { btc: 'signet', eth: 'sepolia', sol: 'devnet', trx: 'nile' });
  assert.deepEqual(effective({ ...DEFAULT_CHAIN_SETTINGS, allowMainnet: true, btcNet: 'mainnet', ethNet: 'mainnet', solNet: 'mainnet', tronNet: 'mainnet' }), { btc: 'mainnet', eth: 'mainnet', sol: 'mainnet', trx: 'mainnet' });
  // a real-money Ethereum-style network (Polygon, BNB…) is ignored too while the setting is off
  assert.equal(effective({ ...DEFAULT_CHAIN_SETTINGS, ethNet: 'polygon' }).eth, 'sepolia');
  assert.throws(() => assertAllowed(DEFAULT_CHAIN_SETTINGS, 'btc', 'mainnet'), /turned off/);
  assert.throws(() => assertAllowed(DEFAULT_CHAIN_SETTINGS, 'eth', 'mainnet'), /turned off/);
  assertAllowed(DEFAULT_CHAIN_SETTINGS, 'eth', 'sepolia');
  assert.equal(DEFAULT_CHAIN_SETTINGS.allowMainnet, false);
});

test('address poisoning: same start and end but not the same address is flagged', () => {
  const real = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
  const fake = real.slice(0, 6) + 'a'.repeat(32) + real.slice(-4);
  assert.equal(fake.length, real.length);
  assert.equal(lookalike(fake, [real]), real);
  assert.equal(lookalike(real, [real]), null);
  assert.equal(lookalike(real.toLowerCase(), [real]), null);
  assert.equal(lookalike('0x1111111111111111111111111111111111111111', [real]), null);
  const b = 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl';
  assert.equal(lookalike(b.slice(0, 8) + 'z'.repeat(b.length - 12) + b.slice(-4), [b]), b);
});

test('Ethereum addresses: checksum enforced on mixed case', () => {
  assert.ok(ethAddressOk('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'));
  assert.ok(ethAddressOk('0x9858effd232b4033e47d90003d41ec34ecaeda94'));
  assert.ok(!ethAddressOk('0x9858EfFD232B4033E47d90003D41EC34EcaEda95'.replace('Eda95', 'eda94')), 'wrong capitals');
  assert.ok(!ethAddressOk('0x1234'));
});

test('an EIP-1559 ETH transfer is signed by the right key with the right fields', async () => {
  const k = ethKey(M, 0);
  const fees = ethFeeChoices(20_000_000_000n, 1_500_000_000n).normal;
  const s = await signEth({ net: 'sepolia', sk: k.sk, nonce: 7, to: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', amount: 10n ** 16n, gas: 21_000n, fees });
  const t = parseTransaction(s.raw);
  assert.equal(t.type, 'eip1559');
  assert.equal(t.chainId, 11155111);
  assert.equal(t.nonce, 7);
  assert.equal(t.value, 10n ** 16n);
  assert.equal(t.to?.toLowerCase(), '0x6fac4d18c912343bf86fa7049364dd4e424ab9c0');
  assert.equal(await recoverTransactionAddress({ serializedTransaction: s.raw }), k.address);
});

test('an ERC-20 send goes to the token contract with transfer(to, amount) and zero ETH', async () => {
  const k = ethKey(M, 0);
  const tok = KNOWN_TOKENS[0];
  const to = '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0';
  const s = await signEth({ net: 'sepolia', sk: k.sk, nonce: 0, to, amount: 5_000_000n, token: tok, gas: 70_000n, fees: ethFeeChoices(10n ** 10n, 10n ** 9n).fast });
  const t = parseTransaction(s.raw);
  assert.equal(t.to?.toLowerCase(), tok.contract.toLowerCase());
  assert.equal(t.value ?? 0n, 0n);
  const d = decodeFunctionData({ abi: ERC20_ABI, data: t.data! });
  assert.equal(d.functionName, 'transfer');
  assert.equal(String(d.args![0]).toLowerCase(), to.toLowerCase());
  assert.equal(d.args![1], 5_000_000n);
  assert.equal(await recoverTransactionAddress({ serializedTransaction: s.raw }), k.address);
});

test('a token is identified by chain and contract, not by symbol', async () => {
  assert.equal(tokenId(KNOWN_TOKENS[0]), '11155111:0x1c7d4b196cb0c7b01d743fbc6116a902379c7238');
  const k = ethKey(M, 0);
  const wrongChain = { ...KNOWN_TOKENS[0], chainId: 1 };
  await assert.rejects(() => signEth({ net: 'sepolia', sk: k.sk, nonce: 0, to: k.address, amount: 1n, token: wrongChain, gas: 70_000n, fees: ethFeeChoices(10n ** 10n, 10n ** 9n).slow }), /different network/);
});

test('fee choices order slow < normal < fast', () => {
  const f = ethFeeChoices(30_000_000_000n, 2_000_000_000n);
  assert.ok(f.slow.maxFeePerGas < f.normal.maxFeePerGas && f.normal.maxFeePerGas < f.fast.maxFeePerGas);
  assert.ok(f.slow.maxPriorityFeePerGas < f.fast.maxPriorityFeePerGas);
});

test('clear signing names the amount, recipient, fee, change and, for tokens, the contract', async () => {
  const k = btcKey(M, 'signet', 0);
  const plan = planBtc([utxo(T1, 100_000n)], 40_000n, 5);
  const lines = describeBtc({ plan, to: btcKey(M, 'signet', 1).address, from: k.address, net: 'signet', rate: 5 }).join(' ');
  assert.match(lines, /Send 0\.0004 sBTC to tb1q/);
  assert.match(lines, /Network fee/);
  assert.match(lines, /comes back to your address/);
  assert.match(lines, /no value/);
  const e = describeEth({ net: 'sepolia', to: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', amount: 5_000_000n, token: KNOWN_TOKENS[0], gas: 70_000n, fees: ethFeeChoices(10n ** 10n, 10n ** 9n).normal }).join(' ');
  assert.match(e, /Send 5 USDC to 0x6Fac/);
  assert.match(e, /Token contract: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238/);
  assert.equal(ETH_NETS.sepolia.real, false);
});

test('unit parsing', () => {
  assert.equal(parseUnits('1.5', 6), 1_500_000n);
  assert.equal(formatUnits(1_500_000n, 6), '1.5');
  assert.throws(() => parseUnits('1.1234567', 6));
});

import { parseEthTxs, parseTokenTxs } from '../src/lib/multichain-core.ts';
test('Ethereum history: sent, received, failed, and calls that move no coin', () => {
  const me = '0xAbC0000000000000000000000000000000000001';
  const other = '0x0000000000000000000000000000000000000002';
  const rows = parseEthTxs({
    items: [
      { hash: '0x1', from: { hash: other }, to: { hash: me.toLowerCase() }, value: '1000000000000000000', status: 'ok', result: 'success', timestamp: '2026-11-16T10:00:00.000000Z' },
      { hash: '0x2', from: { hash: me }, to: { hash: other }, value: '5', status: 'error', result: 'out of gas', timestamp: '2026-11-16T09:00:00.000000Z' },
      { hash: '0x3', from: { hash: me }, to: { hash: other }, value: '0' },
      { hash: '0x4', from: { hash: other }, to: { hash: other }, value: '9' },
    ],
  }, me, 'ETH');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].delta, 10n ** 18n);
  assert.equal(rows[0].time, Date.parse('2026-11-16T10:00:00Z') / 1000);
  assert.equal(rows[1].delta, -5n);
  assert.equal(rows[1].failed, true);
  assert.deepEqual(parseEthTxs(null, me, 'ETH'), []);
});
test('Token history reads the amount in the token\'s own decimals', () => {
  const me = '0xabc0000000000000000000000000000000000001';
  const rows = parseTokenTxs({ items: [{ transaction_hash: '0xa', from: { hash: '0x2' }, to: { hash: me }, total: { value: '2500000', decimals: '6' }, token: { symbol: 'USDC' }, timestamp: '2026-11-16T10:00:00Z' }] }, me);
  assert.equal(rows[0].delta, 2500000n);
  assert.equal(rows[0].decimals, 6);
  assert.equal(rows[0].symbol, 'USDC');
});
