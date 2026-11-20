import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAlerts, fresh, prune, rotationKey, noWatchtower } from '../src/lib/watch-core.ts';

const acct = (over: any = {}) => ({ address: 'lyx1me', balance: '0', balanceLyx: '0', nonce: 0, pendingNonce: 0, atHeight: 0, locked: '0', lockedLyx: '0', contract: null, ...over });
const pend = (id: string, extra: any = {}) => ({ id, vault: 'lyx1me', kind: 'withdraw', releaseHeight: 500, height: 100, byHeir: false, to: 'lyx1thief', amount: '1', amountLyx: '500', ...extra });
const vault = (pending: any[]) => ({ settings: {}, allowanceLeft: '0', allowanceLeftLyx: '0', dayResetsAt: 0, lastActive: 0, heirCanClaimFrom: null, pending });

test('a withdrawal this phone did not start raises an alert; its own does not', () => {
  const a = acct({ vault: vault([pend('0xaa'), pend('0xbb')]) });
  const out = findAlerts([a as any], new Set(['bb']));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'aa');
  assert.match(out[0].text, /withdrawal of 500 LYX/);
});

test('settings changes, closing and heir claims each alert', () => {
  const a = acct({ vault: vault([pend('0x01', { kind: 'update' }), pend('0x02', { kind: 'close' }), pend('0x03', { byHeir: true })]) });
  assert.deepEqual(findAlerts([a as any], new Set()).map((x) => x.kind), ['update', 'close', 'heir']);
});

test('a key rotation this phone did not start alerts; one it started does not', () => {
  const a = acct({ pendingRotation: { newKey: 'lyx1new', releaseHeight: 900 } });
  assert.equal(findAlerts([a as any], new Set()).length, 1);
  assert.equal(findAlerts([a as any], new Set([rotationKey('lyx1me', 'lyx1new')])).length, 0);
});

test('each item alerts once, and the told list forgets what is gone', () => {
  const a = acct({ vault: vault([pend('0xaa')]) });
  const all = findAlerts([a as any], new Set());
  const told = new Set<string>();
  assert.equal(fresh(all, told).length, 1);
  told.add(all[0].key);
  assert.equal(fresh(all, told).length, 0);
  assert.equal(prune(told, []).size, 0);
  assert.equal(prune(told, all).size, 1);
});

test('no vault and no rotation means no alerts', () => {
  assert.deepEqual(findAlerts([acct() as any], new Set()), []);
});

test('the watchtower hook exists and does nothing yet', async () => {
  assert.equal(noWatchtower.name, 'none');
  await noWatchtower.register('lyx1me', { cancelKinds: ['withdraw'] });
});

import { balanceRise, judgeChange, newReceipts, receiptKey } from '../src/lib/watch-core.ts';

test('incoming: only received payments not told yet; mining rewards and sends are not announced', () => {
  const base = { height: 1, blockHash: 'bb', timestamp: 0, confirmations: 1, amount: '1', amountLyx: '1' };
  const items = [
    { ...base, kind: 'received' as const, txHash: '0xAA', from: 'lyx1x' },
    { ...base, kind: 'mined' as const, blockHash: 'cc' },
    { ...base, kind: 'sent' as const, txHash: 'dd' },
    { ...base, kind: 'received' as const, txHash: 'ee' },
  ];
  const seen = new Set([receiptKey('me', { txHash: 'aa', blockHash: '' })]);
  assert.deepEqual(newReceipts('me', items, seen).map((i) => i.txHash), ['ee']);
  assert.equal(newReceipts('other', items, seen).length, 2);
});

test('incoming: a balance rise is reported only after a first look, and never for a drop', () => {
  assert.equal(balanceRise(undefined, 500n), 0n);
  assert.equal(balanceRise('100', 500n), 400n);
  assert.equal(balanceRise('500', 100n), 0n);
  assert.equal(balanceRise('junk', 100n), 0n);
});

test('balance alerts: a server a block behind, or this phone\'s own send, is not announced', () => {
  // two reads disagree (one server lagging): nothing is announced and the old balance is kept
  assert.deepEqual(judgeChange('100', 40n, 100n, null), { next: '100', up: 0n, down: 0n });
  // both reads agree on a real drop: announced
  assert.deepEqual(judgeChange('100', 40n, 40n, null), { next: '40', up: 0n, down: 60n });
  // this phone sent something 5 minutes ago: the drop is expected, the balance is just re-based
  assert.deepEqual(judgeChange('100', 40n, 40n, 5 * 60_000), { next: '40', up: 0n, down: 0n });
  // a long time after an own send, a drop is announced again
  assert.equal(judgeChange('100', 40n, 40n, 3 * 3600_000).down, 60n);
  // a payment in is always announced when both reads agree
  assert.equal(judgeChange('100', 500n, 500n, 60_000).up, 400n);
  // first look: nothing to compare with
  assert.deepEqual(judgeChange(undefined, 9n, 9n, null), { next: '9', up: 0n, down: 0n });
});
