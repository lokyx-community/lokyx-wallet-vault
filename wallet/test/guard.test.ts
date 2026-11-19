import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRUST_WAIT_MS, NEW_DEVICE_MS, addTrusted, addressBlocks, addressRisk, canPay, cancelOff, destinationState, newDeviceCheck, newDeviceRoom, pledgeOk, protectionActive,
  removeTrusted, requestOff, safeAddressProblem, startNewDevice, tailMatches, tailOf, waitText, STORAGE_PLEDGES,
} from '../src/lib/guard-core.ts';

const A = '0xAbCdEf0000000000000000000000000000001234';
const B = '0x9999990000000000000000000000000000005678';
const T0 = 1_700_000_000_000;

test('a new destination waits 24 hours; a known one does not', () => {
  const base = { dest: A, known: [] as string[], trusted: {}, now: T0 };
  assert.deepEqual(destinationState(base), { state: 'new' });
  assert.equal(canPay(destinationState(base)), false);
  assert.deepEqual(destinationState({ ...base, known: [A.toLowerCase()] }), { state: 'known' });
  const t = addTrusted({}, A, T0);
  const w = destinationState({ ...base, trusted: t, now: T0 + 3600_000 });
  assert.equal(w.state, 'waiting');
  assert.equal(canPay(w), false);
  assert.equal((w as { readyAt: number }).readyAt, T0 + TRUST_WAIT_MS);
  assert.equal(destinationState({ ...base, trusted: t, now: T0 + TRUST_WAIT_MS }).state, 'trusted');
  assert.equal(canPay(destinationState({ ...base, trusted: t, now: T0 + TRUST_WAIT_MS + 1 })), true);
});

test('adding an address again does not restart its clock; removing works', () => {
  const t = addTrusted({}, A, T0);
  assert.equal(addTrusted(t, A.toUpperCase().replace('0X', '0x'), T0 + 999), t);
  assert.deepEqual(removeTrusted(t, A), {});
  assert.deepEqual(removeTrusted(t, B), t);
});

test('turning the protection off waits as long, and can be cancelled', () => {
  let p = { on: true } as { on: boolean; offAt?: number };
  assert.equal(protectionActive(p, T0), true);
  p = requestOff(p, T0);
  assert.equal(protectionActive(p, T0 + 1000), true);
  assert.equal(requestOff(p, T0 + 5000), p); // asking again does not push it back or forward
  assert.equal(protectionActive(p, T0 + TRUST_WAIT_MS), false);
  assert.equal(protectionActive(cancelOff(p), T0 + TRUST_WAIT_MS * 2), true);
  assert.equal(protectionActive({ on: false }, T0), false);
});

test('waiting time reads plainly', () => {
  assert.equal(waitText(30_000), '1 min');
  assert.equal(waitText(45 * 60_000), '45 min');
  assert.equal(waitText(5 * 3600_000 + 20 * 60_000), '5 h 20 min');
  assert.equal(waitText(23 * 3600_000 + 59 * 60_000), '24 h');
});

test('new phone: only a tenth of the biggest balance can leave in two days, then no limit', () => {
  const n = startNewDevice(T0);
  const asset = 'eth:1';
  const ten = 10n ** 18n;
  assert.equal(newDeviceRoom(n, asset, 10n * ten), ten);
  const a = newDeviceCheck(n, T0 + 1000, asset, 10n * ten, ten);
  assert.equal(a.ok, true);
  if (!a.ok || !a.next) throw new Error('should fit');
  // balance fell after the send, but the peak is remembered, so the cap does not shrink to a tenth of the rest
  const b = newDeviceCheck(a.next, T0 + 2000, asset, 9n * ten, 1n);
  assert.equal(b.ok, false);
  if (b.ok) throw new Error('over the cap');
  assert.equal(b.room, 0n);
  assert.equal(b.until, T0 + NEW_DEVICE_MS);
  // another coin has its own room
  assert.equal(newDeviceCheck(a.next, T0 + 2000, 'btc', 5n, 0n).ok, true);
  // after the window nothing is limited and nothing is recorded
  const after = newDeviceCheck(a.next, T0 + NEW_DEVICE_MS, asset, 9n * ten, 9n * ten);
  assert.deepEqual(after, { ok: true, next: null });
  assert.deepEqual(newDeviceCheck(null, T0, asset, 1n, 1n), { ok: true, next: null });
});

test('new phone: an empty or tiny balance can still send nothing odd', () => {
  const n = startNewDevice(T0);
  assert.equal(newDeviceRoom(n, 'x', 0n), 0n);
  assert.equal(newDeviceCheck(n, T0, 'x', 5n, 1n).ok, false); // a tenth of 5 rounds down to 0
});

test('address blocks, tail check', () => {
  assert.deepEqual(addressBlocks('0xAbCdEf12'), ['0x', 'AbCd', 'Ef12']);
  assert.deepEqual(addressBlocks('lyx1qpvvab'), ['lyx1', 'qpvv', 'ab']);
  assert.equal(tailOf(A), '001234'.slice(-6));
  assert.equal(tailMatches(A, '001234'), true);
  assert.equal(tailMatches(A, '001234 '), true);
  assert.equal(tailMatches(A, '00123'), false);
  assert.equal(tailMatches(A, '001235'), false);
});

test('look-alike: same ends, different middle, is caught at 3 + 3 and across forms; exact is not a warning', () => {
  const known = [A];
  assert.deepEqual(addressRisk(A, known), { risk: 'same' });
  assert.deepEqual(addressRisk(A.toLowerCase(), known), { risk: 'same' });
  const fake = '0xAbC' + '1'.repeat(34) + '234';
  assert.deepEqual(addressRisk(fake, known), { risk: 'lookalike', imitates: A });
  // only the start matches: not a look-alike
  assert.deepEqual(addressRisk('0xAbC' + '1'.repeat(34) + '999', known), { risk: 'new' });
  assert.deepEqual(addressRisk(B, known), { risk: 'new' });
  assert.deepEqual(addressRisk(B, []), { risk: 'new' });
  // a Bitcoin look-alike
  const btc = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  assert.equal(addressRisk('bc1qar0' + 'x'.repeat(33) + 'mdq', [btc]).risk, 'lookalike');
  // different families never match each other
  assert.deepEqual(addressRisk('lyx1qar' + 'x'.repeat(30) + 'mdq', [btc]), { risk: 'new' });
});

test('safe address must not come from the same 12 words or be the owner', () => {
  const o = { recoveryDerived: 'lyx1aaa', owner: 'lyx1own' };
  assert.match(safeAddressProblem('LYX1AAA', o)!, /same 12 words/);
  assert.match(safeAddressProblem('lyx1own', o)!, /different account/);
  assert.match(safeAddressProblem('  ', o)!, /Choose/);
  assert.equal(safeAddressProblem('lyx1other', o), null);
});

test('storage pledge needs every box', () => {
  assert.equal(pledgeOk([true, true]), false);
  assert.equal(pledgeOk(STORAGE_PLEDGES.map(() => true)), true);
  assert.equal(pledgeOk([true, false, true]), false);
});
