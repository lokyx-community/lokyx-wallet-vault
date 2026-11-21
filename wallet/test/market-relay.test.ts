import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS worker
import { handle, route } from '../market-relay/worker.mjs';

const fakeCache = () => {
  const m = new Map<string, string>();
  return {
    async match(r: Request) { const v = m.get(r.url); return v === undefined ? undefined : new Response(v); },
    async put(r: Request, res: Response) { m.set(r.url, await res.text()); },
  };
};
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
const pending: Promise<unknown>[] = [];
const get = (path: string) => new Request(`https://relay.test${path}`);

test('only the three questions are answered, in a fixed shape', () => {
  assert.equal(route(new URL('https://x/api/v3/coins/bitcoin')).kind, 'coin');
  assert.equal(route(new URL('https://x/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7')).kind, 'chart');
  assert.equal(route(new URL('https://x/api/v3/coins/markets?vs_currency=inr&ids=eth,bitcoin,eth')).up, '/api/v3/coins/markets?vs_currency=inr&ids=bitcoin,eth&sparkline=true&price_change_percentage=24h&per_page=250');
  for (const bad of ['/api/v3/coins/markets?vs_currency=eur&ids=bitcoin', '/api/v3/coins/markets?vs_currency=usd', '/api/v3/coins/Bit%20coin', '/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=9999', '/api/v3/search?query=x', '/api/v3/coins/bitcoin/tickers', '/api/v3/coins/markets?vs_currency=usd&ids=../x'])
    assert.equal(route(new URL(`https://x${bad}`)), null, bad);
});

test('one call to CoinGecko serves many phones, and a busy feed serves the last good answer', async () => {
  const cache = fakeCache();
  let calls = 0, fail = false, key = '';
  const f = async (_u: string, init: any) => { calls++; key = init.headers['x-cg-demo-api-key'] ?? ''; return fail ? new Response('no', { status: 429 }) : new Response('{"id":"bitcoin"}'); };
  const a = await handle(get('/api/v3/coins/bitcoin'), { CG_KEY: 'k1' }, ctx, cache, f);
  await Promise.all(pending);
  assert.equal(a.status, 200); assert.equal(key, 'k1');
  const b = await handle(get('/api/v3/coins/bitcoin'), {}, ctx, cache, f);
  assert.equal(b.headers.get('x-lokyx-cache'), 'hit'); assert.equal(calls, 1);
  assert.equal(await b.text(), '{"id":"bitcoin"}');
  // fresh copy gone, feed down: the day-old copy
  const cache2 = fakeCache();
  await handle(get('/api/v3/coins/dai'), {}, ctx, cache2, async () => new Response('{"id":"dai"}'));
  await Promise.all(pending);
  (cache2 as any).match = (orig => async (r: Request) => (r.url.includes('/stale/') ? orig(r) : undefined))(cache2.match);
  fail = true;
  const c = await handle(get('/api/v3/coins/dai'), {}, ctx, cache2, f);
  assert.equal(c.status, 200); assert.equal(c.headers.get('x-lokyx-stale'), '1');
  // nothing saved and the feed down: an honest 502
  const d = await handle(get('/api/v3/coins/solana'), {}, ctx, fakeCache(), f);
  assert.equal(d.status, 502);
  assert.equal((await handle(new Request('https://relay.test/api/v3/coins/bitcoin', { method: 'POST' }), {}, ctx, fakeCache(), f)).status, 405);
});

test('something that is not JSON is never kept', async () => {
  const cache = fakeCache();
  const r = await handle(get('/api/v3/coins/bitcoin'), {}, ctx, cache, async () => new Response('<html>oops</html>'));
  assert.equal(r.status, 502);
});
