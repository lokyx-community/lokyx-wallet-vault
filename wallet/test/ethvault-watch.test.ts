import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, type Hex } from 'viem';
import { ADDR, makeWorld } from './helpers/vault-fixture.ts';
import { ABI, DEFAULT_WAIT, ETH, queueData, readLive, resetAdjusted, signAction, type QueuedItem } from '../src/lib/ethvault-core.ts';
import { ethAlerts, startedKey } from '../src/lib/ethvault-watch-core.ts';

const ETH1 = 10n ** 18n;

async function queued(w: Awaited<ReturnType<typeof makeWorld>>, to: Hex, value: bigint): Promise<QueuedItem> {
  assert.ok((await w.evm.raw(ADDR.phone, w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'execTransactionFromModule', args: [to, value, '0x', 0] }))).ok);
  const created = await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'getTxCreatedAt', [0n]);
  const hash = await w.evm.call<Hex>(ADDR.helper, w.a.delay, ABI.delay, 'getTxHash', [0n]);
  return { nonce: 0n, txHash: hash, to, value, data: '0x', operation: 0, createdAt: Number(created), readyAt: Number(created) + DEFAULT_WAIT, expiresAt: Number(created) + DEFAULT_WAIT + 7 * 86400 };
}

test('watch: a queued withdrawal this phone did not start is an alert; one it started is not', async () => {
  const w = await makeWorld({ gated: false }); // the phone queues straight into the Delay on an older vault
  const item = await queued(w, ADDR.thief, 5n * ETH1);
  const live = await readLive(w.reader, w.expected);
  const now = Number(w.evm.time);
  const a = ethAlerts('base-sepolia', 'Base Sepolia', live, w.expected, [item], new Set(), now);
  assert.equal(a.filter((x) => x.kind === 'queued').length, 1);
  assert.match(a[0].text, /Send 5 ETH/);
  assert.equal(a[0].readyAt, item.readyAt);
  const mine = ethAlerts('base-sepolia', 'Base Sepolia', live, w.expected, [item], new Set([startedKey('base-sepolia', 0n)]), now);
  assert.equal(mine.length, 0);
});

test('watch: a cancelled or expired item is not an alert', async () => {
  const w = await makeWorld({ gated: false });
  const item = await queued(w, ADDR.thief, ETH1);
  const live = await readLive(w.reader, w.expected);
  const cancelled = { ...live, delay: { ...live.delay, txNonce: 1n } };
  assert.equal(ethAlerts('n', 'N', cancelled, w.expected, [item], new Set(), Number(w.evm.time)).length, 0);
  assert.equal(ethAlerts('n', 'N', live, w.expected, [item], new Set(), item.expiresAt + 1).length, 0);
});

test('watch: an unexpected live setting is an alert even with nothing queued; a healthy vault has none', async () => {
  const w = await makeWorld({ lock: false }); // an owner key must exist to change a setting directly
  const live = await readLive(w.reader, w.expected);
  assert.deepEqual(ethAlerts('n', 'N', live, w.expected, [], new Set(), Number(w.evm.time)), []);
  const t = { to: w.a.delay, value: 0n, data: encodeFunctionData({ abi: ABI.delay, functionName: 'setTxCooldown', args: [60n] }), operation: 0 as const, nonce: await w.safeNonce() };
  assert.ok((await w.submit(ADDR.helper, await signAction((await import('./helpers/vault-fixture.ts')).KEYS.recovery, 84532, w.a.safe, 'cancel', t, 't'))).ok);
  const bad = ethAlerts('n', 'N', await readLive(w.reader, w.expected), w.expected, [], new Set(), Number(w.evm.time));
  assert.ok(bad.some((x) => x.kind === 'config' && /wait/.test(x.text)));
});

test('watch: a queued delegatecall is flagged as danger (an older vault: a gated one refuses it)', async () => {
  const w = await makeWorld({ gated: false });
  assert.ok((await w.evm.raw(ADDR.phone, w.a.delay, encodeFunctionData({ abi: ABI.delay, functionName: 'execTransactionFromModule', args: [ADDR.thief, 0n, '0x', 1] }))).ok);
  const created = Number(await w.evm.call<bigint>(ADDR.helper, w.a.delay, ABI.delay, 'getTxCreatedAt', [0n]));
  const item: QueuedItem = { nonce: 0n, txHash: '0x00', to: ADDR.thief, value: 0n, data: '0x', operation: 1, createdAt: created, readyAt: created + DEFAULT_WAIT, expiresAt: created + DEFAULT_WAIT + 7 * 86400 };
  const a = ethAlerts('n', 'N', await readLive(w.reader, w.expected), w.expected, [item], new Set(), Number(w.evm.time));
  assert.equal(a.find((x) => x.kind === 'queued')?.level, 'danger');
});

test('allowance left today: resets after the period, otherwise amount minus spent', () => {
  const day = 1440n;
  const at = (min: number) => min * 60;
  assert.equal(resetAdjusted([100n, 30n, day, 1000n, 0n], at(1100)), 70n);
  assert.equal(resetAdjusted([100n, 30n, day, 1000n, 0n], at(1000 + 1440)), 100n);
  assert.equal(resetAdjusted([100n, 100n, day, 1000n, 0n], at(1001)), 0n);
  assert.equal(resetAdjusted([100n, 30n, 0n, 0n, 0n], at(99999)), 70n);
  void ETH; void queueData;
});
