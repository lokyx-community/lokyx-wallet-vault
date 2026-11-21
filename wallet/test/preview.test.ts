import test from 'node:test';
import assert from 'node:assert/strict';
import { previewWords, parseSimulate, parseTrace, effects, toPreview, previewTone, TRANSFER, SINGLE, BATCH, NATIVE_ADDR } from '../src/lib/preview-core.ts';

const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const NFT = '0xed5af388653567af2f388e6224dc7c4b3241c544';
const pad = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`;
const w = (n: bigint) => n.toString(16).padStart(64, '0');
const erc20 = (token: string, from: string, to: string, n: bigint) => ({ address: token, topics: [TRANSFER, pad(from), pad(to)], data: `0x${w(n)}` });
const nft = (token: string, from: string, to: string, id: bigint) => ({ address: token, topics: [TRANSFER, pad(from), pad(to), `0x${w(id)}`], data: '0x' });
const native = (from: string, to: string, n: bigint) => erc20(NATIVE_ADDR, from, to, n);

test('a swap: coin leaves, token arrives', () => {
  const e = effects([native(ME, OTHER, 10n ** 16n), erc20(USDC, OTHER, ME, 158_000_000n)], ME);
  assert.deepEqual(e.out, [{ token: 'native', amount: 10n ** 16n }]);
  assert.deepEqual(e.in, [{ token: USDC, amount: 158_000_000n }]);
});

test('moves between other accounts are not yours', () => {
  const e = effects([erc20(USDC, OTHER, '0x3333333333333333333333333333333333333333', 5n)], ME);
  assert.deepEqual(e, { out: [], in: [] });
});

test('an item and a 1155 batch are read', () => {
  const data = `0x${w(64n)}${w(160n)}${w(2n)}${w(7n)}${w(8n)}${w(2n)}${w(1n)}${w(3n)}`;
  const e = effects([nft(NFT, ME, OTHER, 4411n), { address: NFT, topics: [BATCH, pad(OTHER), pad(ME), pad(OTHER)], data }], ME);
  assert.equal(e.out.length, 3);
  assert.deepEqual(e.out.find((m) => m.nft), { token: NFT, id: 4411n, nft: true, amount: 1n });
  assert.equal(e.out.find((m) => m.id === 8n)?.amount, 3n);
});

test('a 1155 single', () => {
  const l = { address: NFT, topics: [SINGLE, pad(OTHER), pad(ME), pad(OTHER)], data: `0x${w(9n)}${w(2n)}` };
  assert.deepEqual(effects([l], ME).out, [{ token: NFT, id: 9n, amount: 2n }]);
});

test('a malformed batch is ignored, not guessed', () => {
  const l = { address: NFT, topics: [BATCH, pad(OTHER), pad(ME), pad(OTHER)], data: `0x${w(64n)}${w(160n)}${w(9999n)}` };
  assert.deepEqual(effects([l], ME), { out: [], in: [] });
});

test('eth_simulateV1 answer', () => {
  const ok = parseSimulate([{ calls: [{ status: '0x1', logs: [erc20(USDC, ME, OTHER, 5n)] }] }]);
  assert.equal(ok.ok && ok.reverted, false);
  const bad = parseSimulate([{ calls: [{ status: '0x0', error: { message: 'execution reverted' }, logs: [] }] }]);
  assert.equal(bad.ok && bad.reverted, true);
  assert.equal(parseSimulate({ nope: 1 }).ok, false);
  assert.equal(parseSimulate([]).ok, false);
});

test('callTracer answer: native value and logs from nested calls', () => {
  const res = {
    type: 'CALL', from: ME, to: OTHER, value: '0x2386f26fc10000',
    calls: [
      { type: 'DELEGATECALL', from: OTHER, to: USDC, value: '0x5' },
      { type: 'CALL', from: OTHER, to: USDC, value: '0x0', logs: [erc20(USDC, OTHER, ME, 7n)] },
      { type: 'CALL', from: OTHER, to: ME, value: '0x1', error: 'reverted inside', logs: [erc20(USDC, ME, OTHER, 99n)] },
    ],
  };
  const e = effects((parseTrace(res) as { logs: never[] }).logs, ME);
  assert.deepEqual(e.out, [{ token: 'native', amount: 0x2386f26fc10000n }]);
  assert.deepEqual(e.in, [{ token: USDC, amount: 7n }]);
  assert.equal(parseTrace({ error: 'x' }).ok, false);
  const failed = parseTrace({ from: ME, to: OTHER, error: 'execution reverted' });
  assert.equal(failed.ok && failed.reverted, true);
});

const call = (value = 0n, data = '0x12345678') => ({ value, data });
const ready = (out: any[], inn: any[], reverted = false) => ({ state: 'ready' as const, out, in: inn, reverted });

test('verdict: a clean swap adds nothing', () => {
  const p = toPreview({ ok: true, reverted: false, logs: [native(ME, OTHER, 10n), erc20(USDC, OTHER, ME, 5n)] }, ME);
  assert.equal(previewTone(p, call(10n)), null);
});

test('verdict: a drain of three assets with nothing back is stopped', () => {
  const p = toPreview({ ok: true, reverted: false, logs: [erc20(USDC, ME, OTHER, 1240n), native(ME, OTHER, 4n), nft(NFT, ME, OTHER, 4411n)] }, ME);
  assert.equal(previewTone(p, call(0n)), 'stop');
});

test('verdict: a token and an item leave, nothing back, is stopped', () => {
  assert.equal(previewTone(ready([{ token: USDC, amount: 1n }, { token: NFT, id: 1n, nft: true, amount: 1n }], []), call()), 'stop');
});

test('verdict: one unexpected token leaving is a warning; a plain transfer is not', () => {
  const p = ready([{ token: USDC, amount: 5n }], []);
  assert.equal(previewTone(p, call()), 'review');
  assert.equal(previewTone(p, call(0n, '0xa9059cbb' + '0'.repeat(128))), null);
});

test('verdict: paying coins and getting nothing visible is a warning', () => {
  assert.equal(previewTone(ready([{ token: 'native', amount: 5n }], []), call(5n)), 'review');
});

test('verdict: a failing request is a warning; no preview adds nothing', () => {
  assert.equal(previewTone(ready([], [], true), call()), 'review');
  assert.equal(previewTone({ state: 'unavailable' }, call()), null);
  assert.deepEqual(toPreview({ ok: false }, ME), { state: 'unavailable' });
});

test('words follow the colour', () => {
  assert.equal(previewWords('review', ready([], [], true) as any, 'ETH')?.headline, 'This would fail');
  assert.match(previewWords('stop', ready([{}, {}, {}], []) as any, 'ETH')!.says, /3 things/);
  assert.equal(previewWords('allow', { state: 'unavailable' }, 'ETH'), null);
});
