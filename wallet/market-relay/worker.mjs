// LOKYX market relay: one shared, cached copy of CoinGecko's price feed for every phone.
// It answers only the three questions the wallet asks (prices, a coin's page, a price chart), in CoinGecko's own shape,
// so the wallet reads it exactly like the real thing. It holds no accounts and no user data and keeps no logs of who asks.
// The CoinGecko key (if you have one) lives here as a secret, never in the app.

const GECKO = 'https://api.coingecko.com';
const CUR = new Set(['usd', 'inr']);
const DAYS = new Set(['1', '7', '30', '365', 'max']);
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TTL = { markets: 60, coin: 900, chart: 300 };
const STALE = 24 * 3600;

const json = (body, status = 200, extra = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

/** What upstream address (and how long to keep it) this request maps to; null if it is not one of the three questions. */
export function route(url) {
  const p = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;
  if (p === '/api/v3/coins/markets') {
    const cur = q.get('vs_currency');
    const ids = (q.get('ids') ?? '').split(',').filter(Boolean);
    if (!CUR.has(cur) || !ids.length || ids.length > 40 || !ids.every((i) => ID.test(i))) return null;
    const list = [...new Set(ids)].sort().join(',');
    return { kind: 'markets', up: `/api/v3/coins/markets?vs_currency=${cur}&ids=${list}&sparkline=true&price_change_percentage=24h&per_page=250` };
  }
  let m = p.match(/^\/api\/v3\/coins\/([^/]+)\/market_chart$/);
  if (m) {
    const cur = q.get('vs_currency');
    const days = q.get('days');
    if (!ID.test(m[1]) || !CUR.has(cur) || !DAYS.has(days)) return null;
    return { kind: 'chart', up: `/api/v3/coins/${m[1]}/market_chart?vs_currency=${cur}&days=${days}` };
  }
  m = p.match(/^\/api\/v3\/coins\/([^/]+)$/);
  if (m && m[1] !== 'markets') {
    if (!ID.test(m[1])) return null;
    return { kind: 'coin', up: `/api/v3/coins/${m[1]}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false` };
  }
  return null;
}

/**
 * The whole worker, with the cache and the network passed in so it can be tested.
 * Fresh copy if we have one; otherwise ask CoinGecko once and keep the answer; if CoinGecko is busy or down,
 * the last good answer (up to a day old), marked with `x-lokyx-stale`.
 */
export async function handle(request, env, ctx, cache, fetchFn) {
  if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, name: 'lokyx-market-relay' });
  const r = route(url);
  if (!r) return json({ error: 'not found' }, 404);

  const fresh = new Request(`https://cache.invalid${r.up}`);
  const stale = new Request(`https://cache.invalid/stale${r.up}`);
  const hit = await cache.match(fresh);
  if (hit) return new Response(hit.body, { status: 200, headers: { 'content-type': 'application/json', 'x-lokyx-cache': 'hit' } });

  let why = 'no answer';
  try {
    const headers = { accept: 'application/json' };
    if (env.CG_KEY) headers['x-cg-demo-api-key'] = env.CG_KEY;
    const up = await fetchFn(`${GECKO}${r.up}`, { headers });
    if (up.ok) {
      const body = await up.text();
      JSON.parse(body); // never keep or pass on something that is not JSON
      const keep = (req, secs) => cache.put(req, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${secs}` } }));
      ctx.waitUntil(Promise.all([keep(fresh, TTL[r.kind]), keep(stale, STALE)]));
      return json(body, 200, { 'x-lokyx-cache': 'miss' });
    }
    why = `CoinGecko said ${up.status}`;
  } catch (e) {
    why = e instanceof SyntaxError ? 'CoinGecko sent something that is not JSON' : 'could not reach CoinGecko';
  }
  const old = await cache.match(stale);
  if (old) return new Response(old.body, { status: 200, headers: { 'content-type': 'application/json', 'x-lokyx-stale': '1' } });
  return json({ error: 'the price feed is busy', why }, 502);
}

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx, caches.default, fetch),
};
