import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMIT2, assess, decodeRequest, endsText, partiesOf, protectionActive, requestOff, type Code, type Ctx, type Request } from '../src/lib/signing-core.ts';

const T0 = 1_700_000_000_000;
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const APP = '0x1111111111111111111111111111111111111111';
const STRANGER = '0x9f3a000000000000000000000000000000c41e01';
const PLAIN = '0x71b0000000000000000000000000000000009d02';
// calldata built by hand (selector + 32-byte words), so these tests need no libraries
const SEL = { approve: '0x095ea7b3', setApprovalForAll: '0xa22cb465', transferOwnership: '0xf2fde38b', increaseAllowance: '0x39509351' } as const;
const w = (v: unknown) => (typeof v === 'string' ? v.slice(2).toLowerCase().padStart(64, '0') : typeof v === 'boolean' ? (v ? '1' : '0').padStart(64, '0') : (v as bigint).toString(16).padStart(64, '0'));
const MAX = (1n << 256n) - 1n;

const ctx = (o: Partial<Ctx> = {}, code: Record<string, Code> = {}): Ctx => ({
  now: T0,
  protectionOn: true,
  known: [APP],
  code: { [APP]: 'contract', [STRANGER]: 'contract', [PLAIN]: 'none', ...code },
  tokenName: (t) => (t?.toLowerCase() === TOKEN.toLowerCase() ? 'USDC' : 'tokens'),
  ...o,
});
const send = (fn: 'approve' | 'setApprovalForAll' | 'transferOwnership' | 'increaseAllowance', args: unknown[]): Request => ({ kind: 'send', to: TOKEN, data: SEL[fn] + args.map(w).join('') });
const judge = (r: Request, c = ctx()) => assess(r, decodeRequest(r), c);

const typed = (primaryType: string, message: unknown, domain: unknown = { name: 'USD Coin', verifyingContract: TOKEN, chainId: 1 }): Request => ({ kind: 'typed', json: JSON.stringify({ domain, primaryType, types: {}, message }) });
const secs = (ms: number) => Math.floor(ms / 1000);

test('an unlimited approval to an address with no history is stopped', () => {
  const a = judge(send('approve', [STRANGER, MAX]));
  assert.equal(a.level, 'stop');
  assert.equal(a.amountText, 'Everything');
  assert.match(a.headline, /take all your USDC/);
  assert.ok(a.reasons.some((r) => r.code === 'unlimitedNew'));
});

test('anything handed to a plain account with no code is stopped, even a small amount', () => {
  const a = judge(send('approve', [PLAIN, 5n]));
  assert.equal(a.level, 'stop');
  assert.ok(a.reasons.some((r) => r.code === 'noCode'));
});

test('a fixed amount to a known app goes straight through', () => {
  const a = judge(send('approve', [APP, 250_000_000n]));
  assert.equal(a.level, 'allow');
  assert.equal(a.why, 'Known app, fixed amount, short time.');
});

test('an unlimited approval to a known app is a review, not a stop', () => {
  const a = judge(send('approve', [APP, MAX]));
  assert.equal(a.level, 'review');
  assert.ok(a.reasons.some((r) => r.code === 'unlimited'));
});

test('increaseAllowance is read the same way as approve', () => {
  assert.equal(judge(send('increaseAllowance', [STRANGER, MAX])).level, 'stop');
});

test('approving a token to Permit2 is the normal first step, so it is not interrupted', () => {
  const a = judge(send('approve', [PERMIT2, MAX], ), ctx({}, { [PERMIT2]: 'contract' }));
  assert.equal(a.level, 'allow');
});

test('setApprovalForAll(true) to an unknown address is stopped; setApprovalForAll(false) is nothing', () => {
  assert.equal(judge(send('setApprovalForAll', [STRANGER, true])).level, 'stop');
  const off = judge(send('setApprovalForAll', [STRANGER, false]));
  assert.equal(off.level, 'allow');
});

test('handing over an account is stopped', () => {
  const a = judge(send('transferOwnership', [STRANGER]));
  assert.equal(a.level, 'stop');
  assert.equal(a.reasons[0].code, 'owner');
  assert.match(a.headline, /hand over your account/);
});

test('a short, fixed EIP-2612 permit to a known app is allowed and says when it ends', () => {
  const r = typed('Permit', { owner: PLAIN, spender: APP, value: '250000000', nonce: 0, deadline: String(secs(T0 + 30 * 60_000)) });
  const a = judge(r);
  assert.equal(a.level, 'allow');
  assert.equal(a.endsText, 'In 30 minutes');
  assert.equal(a.amountText, '250000000');
});

test('a permit that never ends, to a new address, is stopped', () => {
  const r = typed('Permit', { owner: PLAIN, spender: STRANGER, value: '1000', nonce: 0, deadline: MAX.toString() });
  const a = judge(r);
  assert.equal(a.level, 'stop');
  assert.equal(a.endsText, 'Never');
  assert.ok(a.reasons.some((x) => x.code === 'neverNew'));
});

test('an unlimited permit to a new address is stopped, and the headline names the token', () => {
  const r = typed('Permit', { owner: PLAIN, spender: STRANGER, value: MAX.toString(), nonce: 0, deadline: String(secs(T0 + 3600_000)) });
  const a = judge(r);
  assert.equal(a.level, 'stop');
  assert.match(a.headline, /USDC/);
  assert.equal(a.sub, 'Signing is free, but it works like a payment later.');
});

test('DAI-style permit (allowed: true) is unlimited by nature', () => {
  const r = typed('Permit', { holder: PLAIN, spender: STRANGER, nonce: 0, expiry: 0, allowed: true });
  assert.equal(judge(r).level, 'stop');
  assert.equal(judge(typed('Permit', { holder: PLAIN, spender: STRANGER, nonce: 0, expiry: 0, allowed: false })).level, 'allow');
});

test('Permit2 PermitSingle: expiration 0 means no end, and the later of the two deadlines is how long it lives', () => {
  const never = typed('PermitSingle', { details: { token: TOKEN, amount: '1000', expiration: '0', nonce: 0 }, spender: STRANGER, sigDeadline: String(secs(T0 + 60_000)) }, { name: 'Permit2', verifyingContract: PERMIT2 });
  const a = judge(never);
  assert.equal(a.level, 'stop');
  assert.equal(a.endsText, 'Never');
  const short = typed('PermitSingle', { details: { token: TOKEN, amount: '1000', expiration: String(secs(T0 + 1800_000)), nonce: 0 }, spender: APP, sigDeadline: String(secs(T0 + 600_000)) }, { name: 'Permit2', verifyingContract: PERMIT2 });
  const b = judge(short);
  assert.equal(b.level, 'allow');
  assert.equal(b.endsText, 'In 30 minutes');
});

test('Permit2 batch and transfer permits are read too', () => {
  const batch = typed('PermitBatch', { details: [{ token: TOKEN, amount: MAX.toString(), expiration: '0', nonce: 0 }], spender: STRANGER, sigDeadline: '0' }, { name: 'Permit2', verifyingContract: PERMIT2 });
  assert.equal(judge(batch).level, 'stop');
  const tf = typed('PermitTransferFrom', { permitted: { token: TOKEN, amount: '5' }, spender: STRANGER, nonce: 1, deadline: String(secs(T0 + 60_000)) }, { name: 'Permit2', verifyingContract: PERMIT2 });
  assert.equal(judge(tf).level, 'review');
});

test('typed data the wallet cannot read, and orders that can sell items, are reviews', () => {
  assert.equal(judge(typed('Mystery', { a: 1 })).level, 'review');
  assert.equal(judge({ kind: 'typed', json: 'not json' }).level, 'review');
  const order = judge(typed('OrderComponents', { offerer: PLAIN }));
  assert.equal(order.level, 'review');
  assert.ok(order.reasons.some((x) => x.code === 'order'));
});

test('a typed Delegation is handing over control, and is stopped', () => {
  assert.equal(judge(typed('Delegation', { delegate: STRANGER })).level, 'stop');
});

test('plain messages and ordinary calls are not judged', () => {
  assert.equal(judge({ kind: 'sign', message: 'Sign in to example.com' }).level, 'allow');
  assert.equal(judge({ kind: 'send', to: APP, data: '0x', value: 1n }).level, 'allow');
});

test('with protection off nothing is judged', () => {
  const a = judge(send('approve', [PLAIN, MAX]), ctx({ protectionOn: false }));
  assert.equal(a.skipped, true);
  assert.equal(a.level, 'allow');
});

test('a spender nobody could look up is not stopped for that alone', () => {
  const a = judge(send('approve', [APP, 1n]), ctx({}, { [APP]: 'unknown' }));
  assert.equal(a.level, 'allow');
});

test('the most dangerous grant is the one drawn', () => {
  const r = typed('PermitBatch', { details: [{ token: TOKEN, amount: '5', expiration: String(secs(T0 + 60_000)), nonce: 0 }, { token: TOKEN, amount: MAX.toString(), expiration: '0', nonce: 0 }], spender: STRANGER, sigDeadline: String(secs(T0 + 60_000)) }, { name: 'Permit2', verifyingContract: PERMIT2 });
  const a = judge(r);
  assert.equal(a.level, 'stop');
  assert.equal(a.amountText, 'Everything');
});

test('partiesOf lists each address once, to be looked up', () => {
  const d = decodeRequest(send('approve', [STRANGER, 1n]));
  assert.deepEqual(partiesOf(d), [STRANGER]);
  assert.deepEqual(partiesOf(decodeRequest({ kind: 'sign', message: 'x' })), []);
});

test('ends text', () => {
  assert.equal(endsText(null, T0), 'Never');
  assert.equal(endsText(undefined, T0), 'Until used');
  assert.equal(endsText(T0 + 60_000, T0), 'In 1 minute');
  assert.equal(endsText(T0 + 5 * 3600_000, T0), 'In 5 hours');
  assert.equal(endsText(T0 + 3 * 86_400_000, T0), 'In 3 days');
  assert.equal(endsText(T0 - 1, T0), 'Already ended');
  assert.equal(endsText(T0 + 400 * 86_400_000, T0), 'Never');
});

test('turning protection off takes 24 hours, and cancelling is instant', () => {
  const on = { on: true };
  assert.equal(protectionActive(on, T0), true);
  const asked = requestOff(on, T0);
  assert.equal(protectionActive(asked, T0 + 23 * 3600_000), true);
  assert.equal(protectionActive(asked, T0 + 24 * 3600_000), false);
});
