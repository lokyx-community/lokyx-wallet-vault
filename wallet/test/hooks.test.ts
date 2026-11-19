import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES } from '../src/lib/features.ts';
import { swapProvider, onRampProvider, registerSwapProvider, registerOnRampProvider, type SwapProvider, type OnRampProvider } from '../src/lib/partners.ts';
import { DEFAULT_USAGE, buildReport, bucketValue, isoWeek, mayReport, maybeSend } from '../src/lib/usage-core.ts';

test('every business flag is off in this build', () => {
  assert.deepEqual(Object.values(FEATURES), [false, false, false]);
});

test('a registered swap or on-ramp provider stays hidden while the flag is off', () => {
  registerSwapProvider({ name: 'x' } as SwapProvider);
  registerOnRampProvider({ name: 'y' } as OnRampProvider);
  assert.equal(swapProvider(), null);
  assert.equal(onRampProvider(), null);
});

test('the swap and buy interfaces carry no fee of the wallet\'s own', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/lib/partners.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /walletFee|appFee|commission|feeRecipient|referral/i);
});

test('usage counts: off by default, and nothing is posted unless flag, opt-in and endpoint are all set', async () => {
  assert.equal(DEFAULT_USAGE.optIn, false);
  let posts = 0;
  const post = async () => { posts++; };
  const report = () => buildReport({ rid: 'r', now: new Date('2026-11-12'), appVersion: '0.1.0', platform: 'ios', vaults: 1, vaultLyx: 500 });
  assert.equal(await maybeSend({ flag: false, settings: { optIn: true }, endpoint: 'https://x', report, post }), false);
  assert.equal(await maybeSend({ flag: true, settings: { optIn: false }, endpoint: 'https://x', report, post }), false);
  assert.equal(await maybeSend({ flag: true, settings: { optIn: true }, endpoint: null, report, post }), false);
  assert.equal(posts, 0);
  assert.equal(await maybeSend({ flag: true, settings: { optIn: true }, endpoint: 'https://x', report, post }), true);
  assert.equal(posts, 1);
  assert.equal(mayReport({ flag: FEATURES.usageCounts, settings: DEFAULT_USAGE, endpoint: 'https://x' }), false);
});

test('a report holds no address, balance or key: only coarse counts', () => {
  const r = buildReport({ rid: 'abc', now: new Date('2026-11-12T10:00:00Z'), appVersion: '0.1.0', platform: 'android', vaults: 2, vaultLyx: 12_345.67 });
  assert.deepEqual(Object.keys(r).sort(), ['appVersion', 'platform', 'rid', 'valueProtected', 'vaults', 'week']);
  assert.equal(r.valueProtected, '<1M');
  assert.equal(r.week, '2026-W46');
  assert.doesNotMatch(JSON.stringify(r), /lyx1|0x|bc1|tb1/);
});

test('value buckets and ISO weeks', () => {
  assert.deepEqual([0, 5, 100, 99_999, 2_000_000].map(bucketValue), ['0', '<100', '<10k', '<1M', '>=1M']);
  assert.equal(isoWeek(new Date('2026-01-01')), '2026-W01');
  assert.equal(isoWeek(new Date('2026-12-31')), '2026-W53');
});
