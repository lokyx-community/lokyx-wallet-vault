import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { decodeFunctionData, encodeFunctionData, getAddress, type Hex } from 'viem';
import { addSignature, assertSignable, createCall, decodePay, describePay, encodePay, execData, netOfChainId, payHash, pendingPays, sharedAddress, tokenPay, validSigners, type Pay } from '../src/lib/ethms-core.ts';
import { ABI } from '../src/lib/ethvault-core.ts';

const keys: Hex[] = ['0x' + '11'.repeat(32), '0x' + '22'.repeat(32), '0x' + '33'.repeat(32)] as Hex[];
const who = keys.map((k) => privateKeyToAccount(k).address);

test('shared Ethereum account: same address in any order; two of three signatures, sorted', async () => {
  const a = sharedAddress({ owners: who, threshold: 2 });
  assert.equal(sharedAddress({ owners: [...who].reverse(), threshold: 2 }), a);
  assert.notEqual(sharedAddress({ owners: who, threshold: 3 }), a);
  const c = createCall({ owners: who, threshold: 2 });
  assert.equal(decodeFunctionData({ abi: ABI.factory, data: c.data }).functionName, 'createProxyWithNonce');

  let p: Pay = { chainId: 11155111, safe: a, to: '0x000000000000000000000000000000000000dEaD', value: '1000000000000000', nonce: '0', sigs: {} };
  p = await addSignature(p, keys[2], who[2]);
  p = decodePay(encodePay(p));
  assert.deepEqual(await validSigners(p, who), [who[2]]);
  await assert.rejects(execData(p, who, 2), /1 more signature/);

  // a signature from someone who isn't an owner doesn't count
  const outsider = '0x' + '44'.repeat(32) as Hex;
  const q = await addSignature(p, outsider, privateKeyToAccount(outsider).address);
  assert.equal((await validSigners(q, who)).length, 1);

  p = await addSignature(p, keys[0], who[0]);
  const ex = await execData(p, who, 2);
  const d = decodeFunctionData({ abi: ABI.safe, data: ex.data });
  assert.equal(d.functionName, 'execTransaction');
  const sig = d.args[9] as Hex;
  assert.equal((sig.length - 2) / 2, 130);
  // first signature belongs to the lower address
  const [lo] = [who[0], who[2]].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1));
  assert.equal(sig.slice(0, 132), p.sigs[lo].slice(0, 132));
});

const dead = '0x000000000000000000000000000000000000dEaD';
const usdc = getAddress('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
const safeAddr = sharedAddress({ owners: who, threshold: 2 });

test('shared account: a token payment is an ERC-20 transfer, signed and sent like any other', async () => {
  const base = { chainId: 84532, safe: safeAddr, nonce: '3' };
  let p = tokenPay(base, usdc, dead, 2_500_000n);
  assert.equal(p.value, '0');
  const v = describePay(p);
  assert.deepEqual(v.kind === 'token' && { t: v.token, to: v.to, a: v.amount }, { t: usdc, to: dead, a: 2_500_000n });
  // the coin payment of an older code (no data field) still reads as a coin payment
  const coin: Pay = { ...base, to: dead, value: '5', sigs: {} };
  assert.equal(describePay(coin).kind, 'coin');
  // the signed bytes differ between a coin payment and a token payment
  const { payHash } = await import('../src/lib/ethms-core.ts');
  assert.notEqual(payHash(coin), payHash(p));
  p = await addSignature(p, keys[0], who[0]);
  p = await addSignature(p, keys[1], who[1]);
  p = decodePay(encodePay(p));
  const ex = await execData(p, who, 2);
  const d = decodeFunctionData({ abi: ABI.safe, data: ex.data });
  assert.equal(d.functionName, 'execTransaction');
  assert.equal((d.args[0] as string).toLowerCase(), usdc.toLowerCase());
  assert.equal(d.args[1], 0n);
  assert.equal(d.args[2], p.data);
});

test('shared account: a payment code that does anything else is refused', () => {
  const base = { chainId: 84532, safe: safeAddr, nonce: '0', sigs: {} };
  // approve(dead, max): the classic drain
  const approve = encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [dead, 2n ** 256n - 1n] });
  assert.equal(describePay({ ...base, to: usdc, value: '0', data: approve }).kind, 'other');
  assert.throws(() => assertSignable({ ...base, to: usdc, value: '0', data: approve }), /will not sign/);
  // a transfer with extra bytes tacked on, or with a coin value attached, is not a plain transfer
  const t = tokenPay({ chainId: 84532, safe: safeAddr, nonce: '0' }, usdc, dead, 1n);
  assert.equal(describePay({ ...t, data: (t.data + '00') as Hex }).kind, 'other');
  assert.equal(describePay({ ...t, value: '1' }).kind, 'other');
  assert.throws(() => tokenPay({ chainId: 1, safe: safeAddr, nonce: '0' }, usdc, dead, 0n), /more than zero/);
});

test('shared account: the network comes from the chain id', () => {
  assert.equal(netOfChainId(84532), 'base-sepolia');
  assert.equal(netOfChainId(8453), 'base');
  assert.equal(netOfChainId(1), 'mainnet');
  assert.equal(netOfChainId(999999), null);
});

test('relay inbox: copies of one payment merge, and wrong, used-up, hidden or odd ones are dropped', async () => {
  const safe = sharedAddress({ owners: who, threshold: 2 });
  const base = { chainId: 11155111, safe, to: '0x000000000000000000000000000000000000dEaD' as Hex, value: '1000', nonce: '0' };
  const a = await addSignature({ ...base, sigs: {} }, keys[0], who[0]);
  const b = await addSignature({ ...base, sigs: {} }, keys[1], who[1]);
  const other: Pay = { ...base, value: '2000', sigs: {} };
  const codes = [encodePay(a), encodePay(b), encodePay(other), 'junk', encodePay({ ...base, safe: who[0], sigs: {} })];

  const out = pendingPays(codes, safe, 11155111, 0n, new Set());
  assert.equal(out.length, 2);
  const merged = out.find((x) => x.sigs === 2)!;
  assert.ok(merged);
  assert.equal((await validSigners(decodePay(merged.code), who)).length, 2);
  assert.equal(merged.hash, payHash(a));

  assert.equal(pendingPays(codes, safe, 11155111, 1n, new Set()).length, 0); // the account moved on: both used up
  assert.equal(pendingPays(codes, safe, 11155111, 0n, new Set([merged.hash])).length, 1); // dismissed
  assert.equal(pendingPays(codes, safe, 1, 0n, new Set()).length, 0); // another network
  assert.equal(pendingPays([encodePay({ ...base, data: '0x12345678' as Hex, sigs: {} })], safe, 11155111, 0n, new Set()).length, 0); // not a plain transfer
});
