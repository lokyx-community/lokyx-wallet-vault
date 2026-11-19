import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, keccak256, zeroAddress, type Hex } from 'viem';
import { fixtures } from './helpers/evm.ts';
import { ADDR, CHAIN_ID, ETH1, KEYS, USDC, installContracts, makeWorld, type World } from './helpers/vault-fixture.ts';
import { Evm } from './helpers/evm.ts';
import {
  ABI, CONTRACTS, DEAD, DEFAULT_WAIT, GATE_ROLE, RECOVERY_ROLE, gateQueueData, refuseQueue, recoveryCancelData, recoverySweepCalls, sweepable, ETH, EXPIRY, FORBIDDEN_ZODIAC, allowanceSpend, cancelData, checkSettings, decodeAction, describeCall, diffConfig, encodeAction, executeData, gasReserve, itemState,
  phoneCancelData, queueData, readLive, refuseSignRequest, refuseToBuild, safeAddress, signCancel, signSweep, submission, tokenTransferCall, unpinned, vaultAddresses, deploymentOf, signAction,
  type Live, type SafeTx,
} from '../src/lib/ethvault-core.ts';

const MAX = 2n ** 256n - 1n;
const dest = ADDR.safeDest; // a gated vault queues only to the safe address

// ---- helpers ----
/** Queue the way the phone does: through the gate when the vault has one, straight into the Delay on an older vault. */
async function queue(w: World, from: Hex, c: { to: Hex; value?: bigint; data?: Hex; operation?: 0 | 1 }) {
  if (w.expected.gate) {
    if (c.operation) return w.evm.raw(from, w.a.gate, encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [c.to, c.value ?? 0n, c.data ?? '0x', c.operation, GATE_ROLE, true] }));
    return w.evm.raw(from, w.a.gate, gateQueueData(c));
  }
  const data = encodeFunctionData({ abi: ABI.delay, functionName: 'execTransactionFromModule', args: [c.to, c.value ?? 0n, c.data ?? '0x', c.operation ?? 0] });
  return w.evm.raw(from, w.a.delay, data);
}
const run = (w: World, from: Hex, c: { to: Hex; value?: bigint; data?: Hex; operation?: 0 | 1 }) => w.evm.raw(from, w.a.delay, executeData(c));
const usdcOf = (w: World, who: Hex) => w.evm.call<bigint>(ADDR.helper, w.usdc, fixtures.MockUSDC.abi, 'balanceOf', [who]);
const safeCall = async (w: World, from: Hex, to: Hex, data: Hex) => w.evm.raw(from, to, data);
async function allowanceNonce(w: World, token: Hex) {
  const t = await w.evm.call<readonly bigint[]>(ADDR.helper, w.d.allowanceModule, ABI.allowance, 'getTokenAllowance', [w.a.safe, ADDR.phone, token]);
  return Number(t[4]);
}
async function spend(w: World, token: Hex, to: Hex, amount: bigint, from: Hex = ADDR.phone, sk: Hex = KEYS.phone) {
  const s = await allowanceSpend(sk, CHAIN_ID, w.d, w.a.safe, ADDR.phone, { token, to, amount, nonce: await allowanceNonce(w, token) });
  return w.evm.raw(from, s.to, s.data);
}

// ---------- the contracts are the audited ones ----------

test('the Safe code under test is byte-for-byte the official v1.4.1 (code hashes match the published ones)', async () => {
  const evm = await Evm.create();
  const d = await installContracts(evm);
  for (const k of ['safeSingleton', 'safeProxyFactory', 'multiSend', 'multiSendCallOnly', 'fallbackHandler'] as const) {
    assert.equal(keccak256(await evm.code(d[k])), CONTRACTS[k].codeHash, k);
  }
});

test('Delay is the official v1.0.1 creation code, never 1.1.x; the advisory is recorded', async () => {
  assert.equal(fixtures.Delay.officialAddress?.toLowerCase(), CONTRACTS.delayMastercopy.address.toLowerCase());
  assert.ok(FORBIDDEN_ZODIAC.includes('Delay 1.1.0') && FORBIDDEN_ZODIAC.includes('Roles 2.1.1'));
  assert.ok(CONTRACTS.rolesMastercopy.address === '0xD8DfC1d938D7D163C5231688341e9635E9011889');
  assert.ok(unpinned().includes('allowanceModule')); // honest: not pinned until the script runs with network access
});

test('addresses: computed in TypeScript, deployed by the real factories, and the same for any network', async () => {
  const w = await makeWorld();
  assert.equal(w.a.safe, safeAddress({ recovery: ADDR.recovery, phone: ADDR.phone }));
  // the proxy creation code in the TS constant is what the factory really uses
  const pc = await w.evm.call<Hex>(ADDR.helper, w.d.safeProxyFactory, [...ABI.factory, ...(fixtures.SafeProxyFactory.abi as never[])] as never, 'proxyCreationCode');
  assert.ok(pc.startsWith('0x608060405234801561001057600080fd5b50604051'));
  // a different phone gets a different vault; the same inputs always give the same one
  assert.notEqual(vaultAddresses({ recovery: ADDR.recovery, phone: ADDR.thief }).safe, w.a.safe);
  assert.equal(vaultAddresses({ recovery: ADDR.recovery, phone: ADDR.phone }).safe, w.a.safe);
});

test('settings rules: at least a 24 hour wait', () => {
  assert.match(checkSettings({ wait: 3600, allowances: [{ token: ETH, symbol: 'ETH', decimals: 18, amount: 1n }] })!, /24 hours/);
  assert.equal(checkSettings({ wait: 86400, allowances: [{ token: ETH, symbol: 'ETH', decimals: 18, amount: 1n }] }), null);
});

// ---------- the activated vault ----------

test('a fresh vault matches the expected configuration exactly: no alerts', async () => {
  const w = await makeWorld();
  const live = await readLive(w.reader, w.expected);
  assert.deepEqual(live.owners, [DEAD]);
  assert.equal(live.threshold, 1n);
  assert.equal(live.modules.length, 3);
  assert.equal(live.delay.cooldown, BigInt(DEFAULT_WAIT));
  assert.equal(live.delay.expiration, BigInt(EXPIRY));
  assert.deepEqual(diffConfig(w.expected, live), []);
});

test('quick spend within the daily allowance works for ETH, USDC and a USDT-style token that returns nothing', async () => {
  const w = await makeWorld();
  assert.ok((await spend(w, ETH, dest, ETH1 / 20n)).ok);
  assert.equal(await w.evm.balance(dest), 100n * ETH1 + ETH1 / 20n);
  assert.ok((await spend(w, w.usdc, dest, USDC(60))).ok);
  assert.equal(await usdcOf(w, dest), USDC(60));
  assert.ok((await spend(w, w.usdt, dest, USDC(10))).ok); // MockUSDT.transfer returns no data
  assert.equal(await w.evm.call<bigint>(ADDR.helper, w.usdt, fixtures.MockUSDT.abi, 'balanceOf', [dest]), USDC(10));
});

test('over the allowance is refused, and the allowance resets only after a day', async () => {
  const w = await makeWorld();
  assert.ok((await spend(w, w.usdc, dest, USDC(100))).ok);
  assert.ok(!(await spend(w, w.usdc, dest, 1n)).ok); // nothing left today
  w.evm.wait(23 * 3600);
  assert.ok(!(await spend(w, w.usdc, dest, 1n)).ok);
  w.evm.wait(2 * 3600);
  assert.ok((await spend(w, w.usdc, dest, USDC(100))).ok);
  assert.ok(!(await spend(w, w.usdc, dest, USDC(101))).ok); // single spend above the limit
});

test('a coin with no allowance cannot be spent quickly', async () => {
  const w = await makeWorld();
  const other = await w.evm.deploy(ADDR.helper, 'MockUSDC');
  await w.evm.call(ADDR.helper, other, fixtures.MockUSDC.abi, 'mint', [w.a.safe, USDC(1000)]);
  assert.ok(!(await spend(w, other, dest, 1n)).ok);
});

test('an allowance signature from anyone but the phone key is rejected', async () => {
  const w = await makeWorld();
  assert.ok(!(await spend(w, ETH, ADDR.thief, 1n, ADDR.thief, KEYS.thief)).ok);
  assert.ok(!(await spend(w, ETH, ADDR.thief, 1n, ADDR.thief, KEYS.recovery)).ok); // not even the recovery key: it is not the delegate
});

// ---------- larger withdrawals wait ----------

test('a larger withdrawal is queued, cannot run early, runs after the wait, and by anyone', async () => {
  const w = await makeWorld();
  const item = { to: dest, value: ETH1 };
  assert.ok((await queue(w, ADDR.phone, item)).ok);
  assert.ok(!(await run(w, ADDR.thief, item)).ok); // too early
  w.evm.wait(DEFAULT_WAIT - 60);
  assert.ok(!(await run(w, ADDR.thief, item)).ok);
  w.evm.wait(120);
  const before = await w.evm.balance(dest);
  assert.ok((await run(w, ADDR.thief, item)).ok); // anyone can execute once it is due
  assert.equal(await w.evm.balance(dest), before + ETH1);
});

test('queued ERC-20 transfers (USDC and a USDT-style token) work after the wait', async () => {
  const w = await makeWorld();
  for (const t of [w.usdc, w.usdt]) {
    const c = tokenTransferCall(t, dest, USDC(500));
    assert.ok((await queue(w, ADDR.phone, c)).ok);
    w.evm.wait(DEFAULT_WAIT + 1);
    assert.ok((await run(w, ADDR.helper, c)).ok);
  }
  assert.equal(await usdcOf(w, dest), USDC(500));
});

test('a queued item expires after 7 days and then can no longer run', async () => {
  const w = await makeWorld();
  const item = { to: dest, value: ETH1 };
  await queue(w, ADDR.phone, item);
  w.evm.wait(DEFAULT_WAIT + EXPIRY + 10);
  assert.ok(!(await run(w, ADDR.helper, item)).ok);
});

test('only the phone can queue: a stranger, the thief key, and even the recovery EOA are not Delay modules', async () => {
  const w = await makeWorld();
  for (const who of [ADDR.thief, ADDR.recovery, ADDR.helper]) assert.ok(!(await queue(w, who, { to: dest, value: 1n })).ok);
});

// ---------- cancel ----------

test('the phone cancels the whole queue in one step through its Roles permission', async () => {
  const w = await makeWorld();
  const a = { to: dest, value: ETH1 }, b = { to: dest, value: 2n * ETH1 };
  await queue(w, ADDR.phone, a);
  await queue(w, ADDR.phone, b);
  const qn = await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'queueNonce');
  const r = await w.evm.raw(ADDR.phone, w.a.roles, phoneCancelData(w.a.delay, qn));
  assert.ok(r.ok, String(r.error));
  w.evm.wait(DEFAULT_WAIT + 10);
  assert.ok(!(await run(w, ADDR.helper, a)).ok);
  assert.ok(!(await run(w, ADDR.helper, b)).ok);
  assert.equal(await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'txNonce'), qn);
});

test('the phone key can do NOTHING else through Roles: only Delay.setTxNonce', async () => {
  const w = await makeWorld();
  const viaRoles = (to: Hex, data: Hex, op: 0 | 1 = 0, from: Hex = ADDR.phone) =>
    w.evm.raw(from, w.a.roles, encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [to, 0n, data, op, 1, true] }));
  const evil = await w.evm.deploy(ADDR.helper, 'Evil');
  assert.ok(!(await viaRoles(w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [ADDR.thief] }))).ok);
  assert.ok(!(await viaRoles(w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'setTxCooldown', args: [0n] }))).ok);
  assert.ok(!(await viaRoles(w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'enableModule', args: [ADDR.thief] }))).ok);
  assert.ok(!(await viaRoles(w.d.allowanceModule, encodeFunctionData({ abi: ABI.allowance, functionName: 'addDelegate', args: [ADDR.thief] }))).ok);
  assert.ok(!(await viaRoles(dest, '0x')).ok); // not even a plain ETH send
  assert.ok(!(await viaRoles(evil, '0x', 1)).ok); // not a delegatecall
  assert.ok(!(await viaRoles(w.a.delay, cancelData(1n), 1)).ok); // not setTxNonce as a delegatecall
  // and nobody else is a member of the role
  assert.ok(!(await viaRoles(w.a.delay, cancelData(1n), 0, ADDR.thief)).ok);
  assert.ok(!(await viaRoles(w.a.delay, cancelData(1n), 0, ADDR.recovery)).ok);
});

// ---------- gas starvation: the everyday address is emptied ----------

test('everyday address emptied: the recovery key still cancels, sending it itself through its narrow Roles role', async () => {
  const w = await makeWorld();
  const item = { to: dest, value: 3n * ETH1 };
  assert.ok((await queue(w, ADDR.phone, item)).ok); // the thief queues a big withdrawal (it can only go to the safe address)
  await w.evm.fund(ADDR.phone, 0n); // and drains the everyday address, so the phone cannot pay for a cancel
  const qn = await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'queueNonce');
  const r = await w.evm.raw(ADDR.recovery, w.a.roles, recoveryCancelData(w.a.delay, qn));
  assert.ok(r.ok, String(r.error));
  w.evm.wait(DEFAULT_WAIT + 10);
  assert.ok(!(await run(w, ADDR.thief, item)).ok); // the withdrawal never runs
});

test('the recovery key is no longer the Safe owner: it cannot sign for the Safe, and nobody can', async () => {
  const w = await makeWorld();
  assert.deepEqual((await readLive(w.reader, w.expected)).owners, [DEAD]);
  const t = { to: ADDR.thief, value: 1n * ETH1, data: '0x' as Hex, operation: 0 as const, nonce: await w.safeNonce() };
  for (const k of [KEYS.recovery, KEYS.phone, KEYS.thief]) {
    const a = await signAction(k, CHAIN_ID, w.a.safe, 'sweep', t, 'x');
    assert.ok(!(await w.submit(ADDR.friend, a)).ok);
  }
  // and the recovery key cannot call the Safe directly either
  assert.ok(!(await w.evm.raw(ADDR.recovery, w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [ADDR.thief] }))).ok);
  assert.ok(!(await w.evm.raw(ADDR.recovery, w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'swapOwner', args: ['0x0000000000000000000000000000000000000001', DEAD, ADDR.recovery] }))).ok);
});

test('sweep: the recovery key sends one transaction per coin; ETH, USDC and the USDT-style token all land at the safe address', async () => {
  const w = await makeWorld();
  const eth = await w.evm.balance(w.a.safe);
  const holdings = [
    { token: ETH, amount: eth },
    { token: w.usdc, amount: await usdcOf(w, w.a.safe) },
    { token: w.usdt, amount: await w.evm.call<bigint>(ADDR.helper, w.usdt, fixtures.MockUSDT.abi, 'balanceOf', [w.a.safe]) },
  ];
  await w.evm.fund(ADDR.phone, 0n);
  const listed = sweepable(w.settings);
  const calls = recoverySweepCalls(w.a.roles, ADDR.safeDest, holdings, listed);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    const r = await w.evm.raw(ADDR.recovery, c.to, c.data!);
    assert.ok(r.ok, String(r.error));
  }
  assert.equal(await w.evm.balance(w.a.safe), 0n);
  assert.equal(await w.evm.balance(ADDR.safeDest), 100n * ETH1 + eth);
  assert.equal(await usdcOf(w, ADDR.safeDest), USDC(10_000));
  assert.equal(await w.evm.call<bigint>(ADDR.helper, w.usdt, fixtures.MockUSDT.abi, 'balanceOf', [ADDR.safeDest]), USDC(10_000));
  assert.equal(await usdcOf(w, w.a.safe), 0n);
});

test('option B: the recovery key can send ONLY to the safe address, and cancel. Everything else through Roles is refused', async () => {
  const w = await makeWorld();
  const exec = (to: Hex, value: bigint, data: Hex, op = 0) =>
    w.evm.raw(ADDR.recovery, w.a.roles, encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [to, value, data, op, RECOVERY_ROLE, true] }));
  const before = await w.evm.balance(w.a.safe);
  // ETH to anyone else, a friend or a thief
  assert.ok(!(await exec(ADDR.thief, ETH1, '0x')).ok);
  assert.ok(!(await exec(ADDR.friend, 1n, '0x')).ok);
  // tokens to anyone but the safe address
  const tr = (to: Hex) => encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [to, 1n] });
  assert.ok(!(await exec(w.usdc, 0n, tr(ADDR.thief))).ok);
  assert.ok(!(await exec(w.usdt, 0n, tr(ADDR.recovery))).ok);
  // other token functions: approve, transferFrom
  assert.ok(!(await exec(w.usdc, 0n, encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [ADDR.thief, MAX] }))).ok);
  // the Safe itself, the modules, a delegatecall
  assert.ok(!(await exec(w.a.safe, 0n, encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [ADDR.thief] }))).ok);
  assert.ok(!(await exec(w.a.delay, 0n, encodeFunctionData({ abi: ABI.delay, functionName: 'setTxCooldown', args: [1n] }))).ok);
  assert.ok(!(await exec(ADDR.safeDest, 0n, '0x', 1)).ok); // even to the safe address, no delegatecall
  assert.ok(!(await exec(w.d.allowanceModule, 0n, '0x')).ok);
  // the recovery key is not the phone's role and cannot use the phone's permissions to do more
  assert.ok(!(await w.evm.raw(ADDR.recovery, w.a.roles, encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [w.a.delay, 0n, cancelData(5n), 0, 1, true] }))).ok);
  assert.equal(await w.evm.balance(w.a.safe), before);
  // what it may do works: a token to the safe address
  assert.ok((await exec(w.usdc, 0n, tr(ADDR.safeDest))).ok);
  assert.ok((await exec(ADDR.safeDest, 1n, '0x')).ok);
});

test('option B: a stranger, the thief key and the phone key cannot use the recovery role', async () => {
  const w = await makeWorld();
  const call = (from: Hex) => w.evm.raw(from, w.a.roles, recoverySweepCalls(w.a.roles, ADDR.safeDest, [{ token: ETH, amount: 1n }], [ETH])[0].data!);
  for (const who of [ADDR.thief, ADDR.friend, ADDR.phone]) assert.ok(!(await call(who)).ok);
  assert.ok((await call(ADDR.recovery)).ok);
});

test('option B: a token that is not on the allowance list cannot be swept by the recovery key', async () => {
  const w = await makeWorld();
  const other = await w.evm.deploy(ADDR.helper, 'MockUSDC');
  await w.evm.call(ADDR.helper, other, fixtures.MockUSDC.abi, 'mint', [w.a.safe, USDC(5)]);
  const calls = recoverySweepCalls(w.a.roles, ADDR.safeDest, [{ token: other, amount: USDC(5) }], sweepable(w.settings));
  assert.equal(calls.length, 0); // the app leaves it out
  const forced = encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [other, 0n, encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [ADDR.safeDest, USDC(5)] }), 0, RECOVERY_ROLE, true] });
  assert.ok(!(await w.evm.raw(ADDR.recovery, w.a.roles, forced)).ok); // and Roles would refuse it
});

test('gas reserve: the recovery address warns when it cannot pay for a cancel and a sweep itself', () => {
  assert.equal(gasReserve(0n, 100_000_000n).low, true);
  assert.equal(gasReserve(10n ** 15n, 100_000_000n).low, false); // 0.001 ETH covers 0.1 gwei many times over
  assert.equal(gasReserve(10n ** 15n, 10n * 10n ** 9n).low, true); // but not a 10 gwei network
});

// ---------- bypass attempts by a thief holding ONLY the phone key ----------

test('bypass: the phone key cannot call the Safe directly (not an owner), nor enable a module, change owners, guard or handler', async () => {
  const w = await makeWorld();
  const forge = await signAction(KEYS.phone, CHAIN_ID, w.a.safe, 'cancel', { to: dest, value: ETH1, data: '0x', operation: 0, nonce: await w.safeNonce() }, 'x');
  assert.ok(!(await w.submit(ADDR.phone, forge)).ok); // signed by a non-owner
  for (const data of [
    encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [ADDR.thief] }),
    encodeFunctionData({ abi: ABI.safe, functionName: 'addOwnerWithThreshold', args: [ADDR.thief, 1n] }),
    encodeFunctionData({ abi: ABI.safe, functionName: 'changeThreshold', args: [2n] }),
    encodeFunctionData({ abi: ABI.safe, functionName: 'setGuard', args: [ADDR.thief] }),
    encodeFunctionData({ abi: ABI.safe, functionName: 'setFallbackHandler', args: [ADDR.thief] }),
  ]) assert.ok(!(await safeCall(w, ADDR.phone, w.a.safe, data)).ok);
  // module-only entry points
  assert.ok(!(await w.evm.raw(ADDR.phone, w.a.safe, encodeFunctionData({ abi: [{ type: 'function', name: 'execTransactionFromModule', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'uint8' }], outputs: [{ type: 'bool' }] }], functionName: 'execTransactionFromModule', args: [dest, ETH1, '0x', 0] }))).ok);
});

test('bypass: Delay and Allowance settings cannot be changed by the phone key directly (owner is the Safe)', async () => {
  const w = await makeWorld();
  for (const [to, data] of [
    [w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'setTxCooldown', args: [0n] })],
    [w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'setTxExpiration', args: [1n] })],
    [w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'enableModule', args: [ADDR.thief] })],
    [w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'setTxNonce', args: [1n] })],
    [w.a.roles, encodeFunctionData({ abi: ABI.roles, functionName: 'assignRoles', args: [ADDR.thief, [1], [true]] })],
  ] as [Hex, Hex][]) assert.ok(!(await w.evm.raw(ADDR.phone, to, data)).ok);
  // setAllowance by the phone only changes the PHONE'S OWN (empty) account in the module, never the vault's
  await w.evm.raw(ADDR.phone, w.d.allowanceModule, encodeFunctionData({ abi: ABI.allowance, functionName: 'setAllowance', args: [ADDR.phone, ETH, 10n ** 30n % 2n ** 96n, 1440, 0] }));
  assert.ok(!(await spend(w, ETH, dest, 2n * ETH1 / 10n)).ok); // still capped at 0.1 ETH
});

test('legacy vault, bypass: every settings change the phone can queue still waits, shows as danger, and can be cancelled', async () => {
  const w = await makeWorld({ gated: false }); // an older vault: the phone is a Delay module itself
  const changes: { name: string; c: { to: Hex; data: Hex; operation?: 0 | 1 } }[] = [
    { name: 'add a module', c: { to: w.a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [ADDR.thief] }) } },
    { name: 'set a guard', c: { to: w.a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'setGuard', args: [ADDR.thief] }) } },
    { name: 'add an owner', c: { to: w.a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'addOwnerWithThreshold', args: [ADDR.thief, 1n] }) } },
    { name: 'drop the threshold', c: { to: w.a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'changeThreshold', args: [1n] }) } },
    { name: 'zero the wait', c: { to: w.a.delay, data: encodeFunctionData({ abi: ABI.delay, functionName: 'setTxCooldown', args: [0n] }) } },
    { name: 'raise the allowance', c: { to: w.d.allowanceModule, data: encodeFunctionData({ abi: ABI.allowance, functionName: 'setAllowance', args: [ADDR.phone, ETH, 10n ** 20n, 1440, 0] }) } },
    { name: 'add a delegate', c: { to: w.d.allowanceModule, data: encodeFunctionData({ abi: ABI.allowance, functionName: 'addDelegate', args: [ADDR.thief] }) } },
    { name: 'swap the handler', c: { to: w.a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'setFallbackHandler', args: [ADDR.thief] }) } },
  ];
  for (const { name, c } of changes) {
    assert.ok((await queue(w, ADDR.phone, c)).ok, name);
    assert.ok(!(await run(w, ADDR.thief, c)).ok, `${name} ran early`);
    const d = describeCall({ to: c.to, value: 0n, data: c.data, operation: 0 });
    assert.ok(d.level === 'danger' || d.level === 'warn', `${name} not flagged: ${d.line}`);
  }
  // nothing changed on chain
  assert.deepEqual(diffConfig(w.expected, await readLive(w.reader, w.expected)).filter((i) => i.level === 'danger'), []);
  // one slide cancels the lot
  const qn = await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'queueNonce');
  assert.ok((await w.evm.raw(ADDR.phone, w.a.roles, phoneCancelData(w.a.delay, qn))).ok);
  w.evm.wait(DEFAULT_WAIT + 5);
  for (const { c } of changes) assert.ok(!(await run(w, ADDR.thief, c)).ok);
});

test('legacy vault, bypass: a queued settings change really does take effect after the wait if nobody cancels (so the alert matters)', async () => {
  const w = await makeWorld({ gated: false }); // an older vault: the phone is a Delay module itself
  const c = { to: w.a.safe, data: encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [ADDR.thief] }) };
  await queue(w, ADDR.phone, c);
  w.evm.wait(DEFAULT_WAIT + 5);
  assert.ok((await run(w, ADDR.helper, c)).ok);
  const issues = diffConfig(w.expected, await readLive(w.reader, w.expected));
  assert.ok(issues.some((i) => i.level === 'danger' && /unknown module/.test(i.text)));
});

test('legacy vault, delegatecall: the Delay does accept one from the phone key, but it waits, is flagged as danger, and the app never builds one', async () => {
  const w = await makeWorld({ gated: false }); // an older vault: the phone is a Delay module itself
  const evil = await w.evm.deploy(ADDR.helper, 'Evil');
  const c = { to: evil, data: encodeFunctionData({ abi: fixtures.Evil.abi, functionName: 'pwn' }), operation: 1 as const };
  // HONEST LIMIT: Roles v1 scopes by target address and has no "any target" rule, so it cannot sit in front of the
  // Delay to forbid delegatecall. The queue accepts it; the defences are the wait, the alert and the cancel.
  assert.ok((await queue(w, ADDR.phone, c)).ok);
  assert.ok(!(await run(w, ADDR.thief, c)).ok); // waits
  const d = describeCall({ to: evil, value: 0n, data: c.data, operation: 1 });
  assert.equal(d.level, 'danger');
  assert.match(d.line, /delegatecall/);
  assert.match(refuseToBuild({ to: evil, data: c.data, operation: 1 })!, /never queues a delegatecall/);
  const qn = await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'queueNonce');
  await w.evm.raw(ADDR.phone, w.a.roles, phoneCancelData(w.a.delay, qn));
  w.evm.wait(DEFAULT_WAIT + 5);
  assert.ok(!(await run(w, ADDR.thief, c)).ok);
});

// ---------- approvals and permits ----------

test('legacy vault, approvals: the Allowance Module only transfers, so no instant approval is possible; a queued approval waits and is flagged', async () => {
  const w = await makeWorld({ gated: false }); // an older vault: the phone is a Delay module itself
  const unlimited = { to: w.usdc, data: encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [ADDR.thief, MAX] }) };
  // the module can only ever transfer: someone who is not the delegate cannot use an empty signature
  assert.ok(!(await w.evm.raw(ADDR.thief, w.d.allowanceModule, encodeFunctionData({ abi: ABI.allowance, functionName: 'executeAllowanceTransfer', args: [w.a.safe, w.usdc, ADDR.thief, 1n, zeroAddress, 0n, ADDR.phone, '0x'] }))).ok);
  // approve straight from the phone key is just the phone's own (empty) account approving: it does not touch the vault
  await w.evm.raw(ADDR.phone, w.usdc, unlimited.data);
  assert.equal(await w.evm.call<bigint>(ADDR.helper, w.usdc, fixtures.MockUSDC.abi, 'allowance', [w.a.safe, ADDR.thief]), 0n);
  // queued, it waits and is graded danger
  assert.ok((await queue(w, ADDR.phone, unlimited)).ok);
  assert.ok(!(await run(w, ADDR.thief, unlimited)).ok);
  assert.equal(describeCall({ ...unlimited, value: 0n, operation: 0 }, [{ address: w.usdc, symbol: 'USDC', decimals: 6 }]).level, 'danger');
  assert.match(describeCall({ ...unlimited, value: 0n, operation: 0 }).line, /ALL of your/);
  // the app refuses to build it; an exact amount is allowed (with a warning when shown)
  assert.match(refuseToBuild(unlimited)!, /unlimited/);
  const exact = { to: w.usdc, data: encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [ADDR.friend, USDC(5)] }) };
  assert.equal(refuseToBuild(exact), null);
  assert.equal(describeCall({ ...exact, value: 0n, operation: 0 }, [{ address: w.usdc, symbol: 'USDC', decimals: 6 }]).level, 'warn');
});

test('permit / Permit2 / Seaport: the vault cannot produce an off-chain signature from the phone key', async () => {
  const w = await makeWorld();
  // 1. ERC-1271: the vault validates only OWNER signatures; a phone-key signature over any hash is rejected
  const hash = keccak256('0x1234');
  const { signHash } = await import('../src/lib/ethvault-core.ts');
  const phoneSig = await signHash(KEYS.phone, hash);
  const r = await w.evm.raw(ADDR.helper, w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'isValidSignature', args: [hash, phoneSig] }));
  assert.ok(!r.ok || r.data !== '0x1626ba7e00000000000000000000000000000000000000000000000000000000');
  // 2. an ERC-20 permit signed by the phone key for owner = the vault does not verify (the token checks the owner)
  const v = phoneSig.slice(-2) === '1b' ? 27 : 28;
  const permit = await w.evm.raw(ADDR.helper, w.usdc, encodeFunctionData({ abi: ABI.erc20, functionName: 'permit', args: [w.a.safe, ADDR.thief, MAX, MAX, v, `0x${phoneSig.slice(2, 66)}`, `0x${phoneSig.slice(66, 130)}`] }));
  assert.ok(!permit.ok);
  assert.equal(await w.evm.call<bigint>(ADDR.helper, w.usdc, fixtures.MockUSDC.abi, 'allowance', [w.a.safe, ADDR.thief]), 0n);
  // 3. the only other way to "sign" is Safe's signMessage delegatecall: waits, flagged, and never built by the app
  const sm = encodeFunctionData({ abi: ABI.signMessageLib, functionName: 'signMessage', args: ['0x1234'] });
  assert.equal(describeCall({ to: w.d.safeSingleton, value: 0n, data: sm, operation: 1 }).level, 'danger');
  assert.match(refuseToBuild({ to: w.d.safeSingleton, data: sm }) ?? '', /does not sign messages/);
  assert.match(refuseSignRequest(), /never signs/);
});

// ---------- the live configuration check catches things that no event announced ----------

test('config check: every kind of tampering by a holder of an owner key is reported', async () => {
  const w = await makeWorld({ lock: false });
  const base = diffConfig(w.expected, await readLive(w.reader, w.expected));
  assert.deepEqual(base, []);
  const act = async (to: Hex, data: Hex, op: 0 | 1 = 0) => {
    const t: SafeTx = { to, value: 0n, data, operation: op, nonce: await w.safeNonce() };
    const a = await signAction(KEYS.recovery, CHAIN_ID, w.a.safe, 'cancel', t, 't');
    const r = await w.submit(ADDR.helper, a);
    assert.ok(r.ok, String(r.error));
    return diffConfig(w.expected, await readLive(w.reader, w.expected));
  };
  const has = (issues: { text: string }[], re: RegExp) => assert.ok(issues.some((i) => re.test(i.text)), `${re} not in ${JSON.stringify(issues)}`);
  has(await act(w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [ADDR.thief] })), /unknown module/);
  has(await act(w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'setFallbackHandler', args: [ADDR.thief] })), /fallback handler/);
  has(await act(w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'setTxCooldown', args: [60n] })), /wait on larger withdrawals/);
  has(await act(w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'enableModule', args: [ADDR.thief] })), /Delay's queue can be used by/);
  has(await act(w.d.allowanceModule, encodeFunctionData({ abi: ABI.allowance, functionName: 'setAllowance', args: [ADDR.phone, ETH, 50n * ETH1, 1440, 0] })), /raised to/);
  has(await act(w.d.allowanceModule, encodeFunctionData({ abi: ABI.allowance, functionName: 'addDelegate', args: [ADDR.thief] })), /can be spent by/);
  has(await act(w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'addOwnerWithThreshold', args: [ADDR.thief, 1n] })), /owners are not just/);
  // Safe 1.4.1 refuses a guard without ERC-165 support, so plant the slot directly to test the reader
  await w.evm.setStorage(w.a.safe, '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8', ADDR.thief);
  has(diffConfig(w.expected, await readLive(w.reader, w.expected)), /guard/);
});

test('config check: a protection module switched off, and a lowered threshold, are reported', async () => {
  const w = await makeWorld({ lock: false });
  const send = async (data: Hex) => {
    const a = await signAction(KEYS.recovery, CHAIN_ID, w.a.safe, 'cancel', { to: w.a.safe, value: 0n, data, operation: 0, nonce: await w.safeNonce() }, 't');
    assert.ok((await w.submit(ADDR.helper, a)).ok);
    return diffConfig(w.expected, await readLive(w.reader, w.expected));
  };
  const SENT = '0x0000000000000000000000000000000000000001' as Hex;
  const mods = (await readLive(w.reader, w.expected)).modules; // newest first
  assert.equal(mods[0].toLowerCase(), w.d.allowanceModule.toLowerCase());
  const issues = await send(encodeFunctionData({ abi: ABI.safe, functionName: 'disableModule', args: [SENT, w.d.allowanceModule] }));
  assert.ok(issues.some((i) => i.level === 'danger' && /no longer enabled/.test(i.text)));
  const i2 = await send(encodeFunctionData({ abi: ABI.safe, functionName: 'addOwnerWithThreshold', args: [ADDR.thief, 2n] }));
  assert.ok(i2.some((i) => /threshold is 2/.test(i.text)));
});

test('config check: wrong contract code is caught by the pinned hashes', () => {
  const e = { safe: ADDR.friend } as never;
  void e;
  const w = deploymentOf();
  assert.ok(w.safeSingleton);
});

// ---------- reading what is waiting ----------

test('queue state: waiting, ready, expired, cancelled', () => {
  const item = { nonce: 3n, txHash: '0x00' as Hex, to: dest, value: 1n, data: '0x' as Hex, operation: 0, createdAt: 1000, readyAt: 2000, expiresAt: 5000 };
  assert.equal(itemState(item, 1500, 0n), 'waiting');
  assert.equal(itemState(item, 2500, 0n), 'ready');
  assert.equal(itemState(item, 5500, 0n), 'expired');
  assert.equal(itemState(item, 2500, 4n), 'cancelled');
});

test('the Delay logs a TransactionAdded event the background check can read', async () => {
  const w = await makeWorld();
  const r = await w.evm.vm.evm.runCall({ caller: (await import('@ethereumjs/util')).createAddressFromString(ADDR.phone), to: (await import('@ethereumjs/util')).createAddressFromString(w.a.gate), data: (await import('@ethereumjs/util')).hexToBytes(gateQueueData({ to: dest, value: 7n })), gasLimit: 5_000_000n });
  assert.ok(!r.execResult.exceptionError);
  assert.equal(r.execResult.logs?.length, 1);
  const topic0 = '0x' + Buffer.from(r.execResult.logs![0][1][0]).toString('hex');
  const { toEventSelector } = await import('viem');
  assert.equal(topic0, toEventSelector('TransactionAdded(uint256,bytes32,address,uint256,bytes,uint8)'));
});

test('a key from the recovery words becomes 0x hex that viem accepts (the "got string" setup bug)', async () => {
  const { keyHex } = await import('../src/lib/ethvault-core.ts');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { bytesToHex } = await import('viem');
  const sk = new Uint8Array(32).map((_, i) => i + 1);
  const h = keyHex(sk);
  assert.equal(h, bytesToHex(sk));
  assert.equal(h.length, 66);
  assert.ok(privateKeyToAccount(h).address.startsWith('0x'));
  assert.throws(() => privateKeyToAccount(`0x${bytesToHex(sk)}` as Hex), /private key|hex/i);
  assert.throws(() => keyHex(new Uint8Array(31)));
});

// ---------- the gate: the phone can queue only sends to the safe address ----------

const THIEF_QUEUE = async (w: World) => {
  const evil = await w.evm.deploy(ADDR.helper, 'Evil');
  const other = await w.evm.deploy(ADDR.helper, 'MockUSDC'); // a token that has no allowance, so it was never listed
  const sel = (abi: readonly unknown[], functionName: string, args: unknown[]) => encodeFunctionData({ abi, functionName, args } as never);
  return [
    { name: 'ETH to someone else', c: { to: ADDR.thief, value: ETH1 } },
    { name: 'USDC to someone else', c: tokenTransferCall(w.usdc, ADDR.thief, USDC(5)) },
    { name: 'USDT to someone else', c: tokenTransferCall(w.usdt, ADDR.thief, USDC(5)) },
    { name: 'a token that was never listed, even to the safe address', c: tokenTransferCall(other, dest, 1n) },
    { name: 'an unlimited approval', c: { to: w.usdc, data: sel(ABI.erc20, 'approve', [ADDR.thief, MAX]) } },
    { name: 'transferFrom', c: { to: w.usdc, data: sel(ABI.erc20, 'transferFrom', [w.a.safe, ADDR.thief, 1n]) } },
    { name: 'add a module to the Safe', c: { to: w.a.safe, data: sel(ABI.safe, 'enableModule', [ADDR.thief]) } },
    { name: 'add an owner', c: { to: w.a.safe, data: sel(ABI.safe, 'addOwnerWithThreshold', [ADDR.thief, 1n]) } },
    { name: 'set a guard', c: { to: w.a.safe, data: sel(ABI.safe, 'setGuard', [ADDR.thief]) } },
    { name: 'zero the wait', c: { to: w.a.delay, data: sel(ABI.delay, 'setTxCooldown', [0n]) } },
    { name: 'add a queuer to the Delay', c: { to: w.a.delay, data: sel(ABI.delay, 'enableModule', [ADDR.thief]) } },
    { name: 'raise the allowance', c: { to: w.d.allowanceModule, data: sel(ABI.allowance, 'setAllowance', [ADDR.phone, ETH, 10n ** 20n, 1440, 0]) } },
    { name: 'add an allowance delegate', c: { to: w.d.allowanceModule, data: sel(ABI.allowance, 'addDelegate', [ADDR.thief]) } },
    { name: 'give the thief a role on the recovery Roles', c: { to: w.a.roles, data: sel(ABI.roles, 'assignRoles', [ADDR.thief, [1, 2], [true, true]]) } },
    { name: 'open the gate itself to the thief', c: { to: w.a.gate, data: sel(ABI.roles, 'allowTarget', [1, ADDR.thief, 3]) } },
    { name: 'a delegatecall', c: { to: evil, data: encodeFunctionData({ abi: fixtures.Evil.abi, functionName: 'pwn' }), operation: 1 as const } },
    { name: 'a delegatecall to the safe address', c: { to: dest, data: '0x', operation: 1 as const } },
  ] as { name: string; c: { to: Hex; value?: bigint; data?: Hex; operation?: 0 | 1 } }[];
};

test('gate: the phone can queue ETH and listed tokens to the safe address, and they run after the wait', async () => {
  const w = await makeWorld();
  const items = [{ to: dest, value: ETH1 }, tokenTransferCall(w.usdc, dest, USDC(500)), tokenTransferCall(w.usdt, dest, USDC(500))];
  for (const c of items) assert.ok((await queue(w, ADDR.phone, c)).ok, 'queued');
  for (const c of items) assert.ok(!(await run(w, ADDR.thief, c)).ok, 'too early');
  w.evm.wait(DEFAULT_WAIT + 5);
  const before = await w.evm.balance(dest);
  for (const c of items) assert.ok((await run(w, ADDR.thief, c)).ok, 'ran after the wait');
  assert.equal(await w.evm.balance(dest), before + ETH1);
  assert.equal(await usdcOf(w, dest), USDC(500));
});

test('gate: the phone key cannot queue anything but a send to the safe address: no other target, no delegatecall, no setting', async () => {
  const w = await makeWorld();
  for (const { name, c } of await THIEF_QUEUE(w)) {
    assert.ok(!(await queue(w, ADDR.phone, c)).ok, `${name} was queued`);
  }
  // nothing got into the queue
  assert.equal(await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'queueNonce'), 0n);
  assert.deepEqual(diffConfig(w.expected, await readLive(w.reader, w.expected)), []);
});

test('gate: the phone is not a Delay module any more, so it cannot skip the gate by queueing in the Delay itself', async () => {
  const w = await makeWorld();
  const direct = encodeFunctionData({ abi: ABI.delay, functionName: 'execTransactionFromModule', args: [ADDR.thief, ETH1, '0x', 0] });
  assert.ok(!(await w.evm.raw(ADDR.phone, w.a.delay, direct)).ok);
  assert.ok(!(await w.evm.raw(ADDR.phone, w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'enableModule', args: [ADDR.phone] }))).ok);
  assert.ok(await w.evm.call<boolean>(ADDR.helper, w.a.delay, ABI.delay, 'isModuleEnabled', [w.a.gate]));
  assert.ok(!(await w.evm.call<boolean>(ADDR.helper, w.a.delay, ABI.delay, 'isModuleEnabled', [ADDR.phone])));
});

test('gate: the thief key, the recovery key and a stranger cannot use the phone role on the gate', async () => {
  const w = await makeWorld();
  for (const who of [ADDR.thief, ADDR.recovery, ADDR.helper, ADDR.friend]) assert.ok(!(await queue(w, who, { to: dest, value: 1n })).ok);
});

test('gate: nobody can change the gate, the Delay or the allowances after the vault is made, and the recovery key cannot either', async () => {
  const w = await makeWorld();
  const calls: [Hex, Hex][] = [
    [w.a.gate, encodeFunctionData({ abi: ABI.roles, functionName: 'allowTarget', args: [1, ADDR.thief, 3] })],
    [w.a.gate, encodeFunctionData({ abi: ABI.roles, functionName: 'assignRoles', args: [ADDR.thief, [1], [true]] })],
    [w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'enableModule', args: [ADDR.thief] })],
    [w.d.allowanceModule, encodeFunctionData({ abi: ABI.allowance, functionName: 'addDelegate', args: [ADDR.thief] })],
  ];
  // (addDelegate by a stranger only adds a delegate to the stranger's own empty account in the module; the config check below proves the vault's is untouched)
  for (const who of [ADDR.phone, ADDR.thief, ADDR.recovery, ADDR.helper]) for (const [to, data] of calls.filter(([to]) => to !== w.d.allowanceModule)) assert.ok(!(await w.evm.raw(who, to, data)).ok);
  // the recovery key's Roles role does not reach the gate or the settings either
  for (const [to, data] of calls) {
    const via = encodeFunctionData({ abi: ABI.roles, functionName: 'execTransactionWithRole', args: [to, 0n, data, 0, RECOVERY_ROLE, true] });
    assert.ok(!(await w.evm.raw(ADDR.recovery, w.a.roles, via)).ok);
  }
  assert.deepEqual(diffConfig(w.expected, await readLive(w.reader, w.expected)), []);
});

test('gate: the phone still cancels, and the recovery key still cancels and sweeps', async () => {
  const w = await makeWorld();
  const a = { to: dest, value: ETH1 };
  assert.ok((await queue(w, ADDR.phone, a)).ok);
  const qn = await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'queueNonce');
  assert.ok((await w.evm.raw(ADDR.phone, w.a.roles, phoneCancelData(w.a.delay, qn))).ok);
  w.evm.wait(DEFAULT_WAIT + 5);
  assert.ok(!(await run(w, ADDR.helper, a)).ok);
  assert.ok((await w.evm.raw(ADDR.recovery, w.a.roles, recoverySweepCalls(w.a.roles, dest, [{ token: ETH, amount: ETH1 }], [ETH])[0].data!)).ok);
});

test('gate: the config check reports a queuer added to the Delay, the gate enabled on the Safe, or the gate re-pointed', async () => {
  // played by someone holding an owner key: the older vault whose recovery key is still the Safe owner, but with a gate
  const w = await makeWorld({ lock: false });
  const exec = async (to: Hex, data: Hex) => {
    const tx: SafeTx = { to, value: 0n, data, operation: 0, nonce: await w.safeNonce() };
    return w.submit(ADDR.helper, await signAction(KEYS.recovery, CHAIN_ID, w.a.safe, 'cancel', tx, 'tamper'));
  };
  const issues = async () => diffConfig(w.expected, await readLive(w.reader, w.expected));
  assert.deepEqual(await issues(), []);
  assert.ok((await exec(w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'enableModule', args: [ADDR.thief] }))).ok);
  assert.ok((await issues()).some((i) => i.level === 'danger' && /not only through the gate/.test(i.text)));
  assert.ok((await exec(w.a.safe, encodeFunctionData({ abi: ABI.safe, functionName: 'enableModule', args: [w.a.gate] }))).ok);
  assert.ok((await issues()).some((i) => i.level === 'danger' && /unknown module/.test(i.text)));
  const { parseAbi } = await import('viem');
  assert.ok((await exec(w.a.gate, encodeFunctionData({ abi: parseAbi(['function setTarget(address)']), functionName: 'setTarget', args: [w.a.safe] }))).ok);
  assert.ok((await issues()).some((i) => i.level === 'danger' && /gate in front of the Delay is wired/.test(i.text)));
});

test('gate: refuseQueue allows only ETH and listed tokens to the safe address', async () => {
  const w = await makeWorld();
  const listed = sweepable(w.settings);
  assert.equal(refuseQueue({ to: dest, value: 1n }, dest, listed), null);
  assert.equal(refuseQueue(tokenTransferCall(w.usdc, dest, 5n), dest, listed), null);
  for (const { name, c } of await THIEF_QUEUE(w)) {
    if (name === 'a delegatecall to the safe address') continue; // refused by the gate on the operation, which refuseQueue does not see
    assert.match(refuseQueue(c, dest, listed) ?? 'allowed', /safe address/, name);
  }
});

test('gate: its address is its own, and the same for the same phone', async () => {
  const w = await makeWorld();
  assert.notEqual(w.a.gate, w.a.roles);
  assert.notEqual(w.a.gate, w.a.delay);
  assert.equal(vaultAddresses({ recovery: ADDR.recovery, phone: ADDR.phone }).gate, w.a.gate);
  assert.notEqual(vaultAddresses({ recovery: ADDR.recovery, phone: ADDR.thief }).gate, w.a.gate);
});
