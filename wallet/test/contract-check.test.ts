import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditOf, combineSources, decodeCall, isMinimalProxy, judge, parseBlockscout, parseSourcify, type Party } from '../src/lib/contract-check-core.ts';

const pad = (a: string) => '0'.repeat(24) + a.replace(/^0x/, '').toLowerCase();
const SPENDER = '0x1111111111111111111111111111111111111111';
const MAXH = 'f'.repeat(64);
const party = (o: Partial<Party> = {}): Party => ({ role: 'contract', address: '0x2222222222222222222222222222222222222222', isContract: true, source: 'verified', proxy: false, audit: null, ...o });

test('decode: approvals, unlimited or not, and setApprovalForAll', () => {
  const a = decodeCall(`0x095ea7b3${pad(SPENDER)}${MAXH}`);
  assert.deepEqual([a.kind, a.spender, a.unlimited], ['approve', SPENDER, true]);
  const b = decodeCall(`0x095ea7b3${pad(SPENDER)}${'0'.repeat(63)}5`);
  assert.equal(b.unlimited, false);
  const c = decodeCall(`0xa22cb465${pad(SPENDER)}${'0'.repeat(63)}1`);
  assert.deepEqual([c.kind, c.grantAll], ['approveAll', true]);
  const off = decodeCall(`0xa22cb465${pad(SPENDER)}${'0'.repeat(64)}`);
  assert.equal(off.grantAll, false);
  const p = decodeCall(`0xd505accf${pad('0x3333333333333333333333333333333333333333')}${pad(SPENDER)}${MAXH}${'0'.repeat(64 * 4)}`);
  assert.deepEqual([p.kind, p.spender, p.unlimited], ['permit', SPENDER, true]);
  assert.equal(decodeCall('0x').kind, 'none');
  assert.equal(decodeCall('0x12345678aa').kind, 'other');
  assert.equal(decodeCall('0x095ea7b3').spender, undefined); // truncated: no guess
  assert.equal(decodeCall('0x8d80ff0a00').kind, 'bundle');
});

test('explorer answers: verified, not verified, and "could not ask"', () => {
  assert.equal(parseBlockscout(200, { is_verified: true, name: 'Vault', proxy_type: null, implementations: [] }).source, 'verified');
  assert.equal(parseBlockscout(200, { is_verified: false }).source, 'unverified');
  assert.equal(parseBlockscout(404, { message: 'Not found' }).source, 'unverified');
  assert.equal(parseBlockscout(500, null).source, 'unknown');
  assert.equal(parseBlockscout(200, { is_verified: true, proxy_type: 'eip1967' }).proxy, true);
  assert.equal(parseSourcify(200, { match: 'exact_match' }).source, 'verified');
  assert.equal(parseSourcify(404, {}).source, 'unverified');
  assert.equal(parseSourcify(503, null).source, 'unknown');
  const none = { source: 'unverified' as const, proxy: false };
  const unk = { source: 'unknown' as const, proxy: false };
  const yes = { source: 'verified' as const, proxy: false, name: 'X' };
  assert.equal(combineSources([none, none]).source, 'unverified');
  assert.equal(combineSources([none, unk]).source, 'unknown'); // one service down is not a "no"
  assert.equal(combineSources([unk, yes]).source, 'verified');
  assert.equal(combineSources([]).source, 'unknown');
});

test('audit list: matches by address, any capitalisation, and only what we know', () => {
  assert.equal(auditOf('0x29fcb43b46531bca003ddc8fcb67ffe91900c762')?.name, 'Safe L2 v1.4.1');
  assert.equal(auditOf('0x0000000000000000000000000000000000000001'), null);
});

test('minimal proxy code is spotted', () => {
  assert.equal(isMinimalProxy('0x363d3d373d3d3d363d73bebebebebebebebebebebebebebebebebebebebe5af43d82803e903d91602b57fd5bf3'), true);
  assert.equal(isMinimalProxy('0x6080604052'), false);
});

test('verdict: unlimited approval to an unreadable contract is the stop sign', () => {
  const call = decodeCall(`0x095ea7b3${pad(SPENDER)}${MAXH}`);
  const v = judge(call, [party({ role: 'contract' }), party({ role: 'spender', address: SPENDER, source: 'unverified' })], false, 0n);
  assert.equal(v.level, 'danger');
  assert.equal(v.review, true);
  assert.ok(v.reasons.some((r) => /no public source/.test(r)));
  assert.ok(v.reasons.some((r) => /unlimited/.test(r)));
});

test('verdict: setApprovalForAll on is danger even when the contract is verified', () => {
  const call = decodeCall(`0xa22cb465${pad(SPENDER)}${'0'.repeat(63)}1`);
  const v = judge(call, [party(), party({ role: 'spender', address: SPENDER })], false, 0n);
  assert.equal(v.level, 'danger');
});

test('verdict: verified but not audited is caution; audited and known is ok; unknown service is caution not ok', () => {
  const call = decodeCall('0x12345678aa');
  assert.equal(judge(call, [party()], false, 0n).level, 'caution');
  const safe = party({ address: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762', audit: auditOf('0x29fcB43b46531BcA003ddC8FCB67FFE91900C762') });
  const ok = judge({ kind: 'transfer', name: 'transfer', bytes: 68 }, [safe], false, 0n);
  assert.deepEqual([ok.level, ok.review], ['ok', false]);
  assert.equal(judge({ kind: 'transfer', name: 'transfer', bytes: 68 }, [party({ source: 'unknown' })], false, 0n).level, 'caution');
});

test('verdict: a new contract always stops, and a bundle is never "ok" by itself', () => {
  assert.equal(judge({ kind: 'other', bytes: 900 }, [], true, 0n).level, 'danger');
  const v = judge({ kind: 'bundle', name: 'multicall', bytes: 300 }, [], false, 0n);
  assert.equal(v.level, 'caution');
});
