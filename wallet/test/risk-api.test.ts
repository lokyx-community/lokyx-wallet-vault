import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { API_CHAINS, flagText, normAddressResult, normTokenResult, worstVerdict } from '../src/lib/risk-api-core.ts';
// @ts-ignore plain JS worker
import { handle } from '../risk-relay/worker.mjs';

const ADDR = '0x' + 'ab'.repeat(20);

test('an address with theft reports is danger; other reports are caution; none is ok', () => {
  assert.deepEqual(normAddressResult({ phishing_activities: '1', money_laundering: '1', cybercrime: '0' }), { level: 'danger', flags: ['phishing_activities', 'money_laundering'], source: 'goplus' });
  assert.equal(normAddressResult({ money_laundering: '1' }).level, 'caution');
  assert.equal(normAddressResult({ phishing_activities: '0', data_source: 'x' }).level, 'ok');
  assert.equal(normAddressResult(null).level, 'unknown');
  assert.equal(normAddressResult('x').level, 'unknown');
});

test('a token that cannot be sold is danger; hidden code is caution; a clean one is ok', () => {
  const r = (t: object) => ({ [ADDR]: t });
  assert.equal(normTokenResult(r({ is_honeypot: '1' }), ADDR.toUpperCase().replace('0X', '0x')).level, 'danger');
  assert.equal(normTokenResult(r({ cannot_sell_all: '1' }), ADDR).level, 'danger');
  assert.equal(normTokenResult(r({ sell_tax: '0.6' }), ADDR).level, 'danger');
  assert.deepEqual(normTokenResult(r({ sell_tax: '0.15', is_open_source: '0', hidden_owner: '1' }), ADDR).flags, ['sellTax', 'closedCode', 'hiddenOwner']);
  assert.equal(normTokenResult(r({ is_open_source: '1', sell_tax: '0', buy_tax: '0.01', is_honeypot: '0' }), ADDR).level, 'ok');
  assert.equal(normTokenResult({}, ADDR).level, 'unknown');
  assert.equal(normTokenResult(undefined, ADDR).level, 'unknown');
});

test('worst verdict and words', () => {
  const v = (level: 'ok' | 'caution' | 'danger' | 'unknown') => ({ level, flags: [], source: 'goplus' as const });
  assert.equal(worstVerdict([v('ok'), null, v('danger'), v('caution')])?.level, 'danger');
  assert.equal(worstVerdict([null, null]), null);
  assert.match(flagText('honeypot'), /not sell/);
  assert.equal(flagText('nope'), 'Flagged by a security service.');
  assert.ok(API_CHAINS.has(1) && !API_CHAINS.has(11155111));
});

// ---- the worker ----
const cache = () => {
  const m = new Map<string, string>();
  return { async match(r: Request) { const v = m.get(r.url); return v === undefined ? undefined : new Response(v); }, async put(r: Request, res: Response) { m.set(r.url, await res.text()); } };
};
const kv = () => {
  const m = new Map<string, string>();
  return { m, async get(k: string, t?: string) { const v = m.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k: string, v: string) { m.set(k, v); } };
};
const ask = (p: string) => new Request(`https://r${p}`);

test('the worker asks about an address, keeps the key as a secret, and caches the answer', async () => {
  const env = { LISTS: kv(), GOPLUS_APP_KEY: 'KEY', GOPLUS_APP_SECRET: 'SEC' };
  const seen: { url: string; auth: string | null; body?: string }[] = [];
  const f = async (u: string, init: any = {}) => {
    seen.push({ url: u, auth: init.headers?.authorization ?? null, body: init.body });
    if (u.endsWith('/api/v1/token')) return new Response(JSON.stringify({ code: 1, result: { access_token: 'T1', expires_in: 7200 } }));
    return new Response(JSON.stringify({ code: 1, result: { stealing_attack: '1' } }));
  };
  const c = cache();
  const a = await handle(ask(`/risk/address?chain=1&address=${ADDR}`), env, f, undefined, c);
  assert.deepEqual(await a.json(), { level: 'danger', flags: ['stealing_attack'], source: 'goplus' });
  const tokenCall = seen.find((s) => s.url.endsWith('/token'))!;
  const sent = JSON.parse(tokenCall.body!);
  assert.equal(sent.app_key, 'KEY');
  assert.equal(sent.sign, createHash('sha1').update(`KEY${sent.time}SEC`).digest('hex'));
  assert.ok(!tokenCall.body!.includes('SEC'), 'the secret itself is never sent');
  const lookup = seen.find((s) => s.url.includes('address_security'))!;
  assert.equal(lookup.auth, 'Bearer T1');
  assert.ok(lookup.url.endsWith(`/address_security/${ADDR}?chain_id=1`));
  const n = seen.length;
  const again = await handle(ask(`/risk/address?chain=1&address=${ADDR}`), env, f, undefined, c);
  assert.equal(again.headers.get('x-lokyx-cache'), 'hit');
  assert.equal(seen.length, n, 'a repeat costs no call');
});

test('a token question reads the token entry', async () => {
  const f = async () => new Response(JSON.stringify({ code: 1, result: { [ADDR]: { is_honeypot: '1' } } }));
  const r = await handle(ask(`/risk/token?chain=56&address=${ADDR.toUpperCase().replace('0X', '0x')}`), { LISTS: kv() }, f, undefined, cache());
  assert.equal((await r.json()).level, 'danger');
});

test('no key, or a key that fails, still asks without one', async () => {
  const calls: (string | null)[] = [];
  const f = async (u: string, init: any = {}) => {
    if (u.endsWith('/token')) return new Response(JSON.stringify({ code: 4012 }), { status: 200 });
    calls.push(init.headers?.authorization ?? null);
    return new Response(JSON.stringify({ code: 1, result: {} }));
  };
  assert.equal((await handle(ask(`/risk/address?chain=1&address=${ADDR}`), { LISTS: kv() }, f, undefined, cache())).status, 200);
  assert.equal((await handle(ask(`/risk/address?chain=8453&address=${ADDR}`), { LISTS: kv(), GOPLUS_APP_KEY: 'k', GOPLUS_APP_SECRET: 's' }, f, undefined, cache())).status, 200);
  assert.deepEqual(calls, [null, null]);
});

test('bad questions are refused and a silent service is a 502, never a made-up answer', async () => {
  const f = async () => new Response('x', { status: 500 });
  for (const q of ['/risk/address?chain=1&address=nope', `/risk/address?chain=11155111&address=${ADDR}`, '/risk/token?chain=1']) assert.equal((await handle(ask(q), { LISTS: kv() }, f, undefined, cache())).status, 400, q);
  assert.equal((await handle(ask(`/risk/address?chain=1&address=${ADDR}`), { LISTS: kv() }, f, undefined, cache())).status, 502);
});
