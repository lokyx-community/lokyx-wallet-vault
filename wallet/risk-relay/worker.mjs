// LOKYX risk relay: hands one small shared copy of the public scam lists to every phone, and asks the security service
// (GoPlus) about a contract when the phone cannot judge it. The lists are built on your own server (build-lists.mjs) and stored
// here; this Worker only serves them, because a free-plan Worker has just 10 ms of CPU per run. The phone checks names itself, so this relay never learns which site or contract anyone
// looked at. It holds no accounts, keeps no logs of who asks, and has no keys in this file.

import { createHash } from 'node:crypto';
import { normAddress } from '../src/lib/risk-lists-core.ts';
import { API_CHAINS, normAddressResult, normTokenResult } from '../src/lib/risk-api-core.ts';

const GOPLUS = 'https://api.gopluslabs.io';
const ANSWER_TTL = 6 * 3600;
// GoPlus's free plan is about 30 calls a minute. Only questions that miss the cache cost a call, and they are counted here so a
// script cannot burn the plan: a few per phone address per minute, and a ceiling for everyone together.
const PER_PHONE_MIN = 12;
const ALL_MIN = 25;

/** Count one use of `name` this minute; false when it is over `max`. (Per data centre and not exact, which is enough for a guard.) */
async function allow(cache, name, max, now) {
  const key = new Request(`https://cache.invalid/rl/${name}/${Math.floor(now / 60_000)}`);
  const seen = Number((await (await cache.match(key))?.text()) ?? 0);
  if (seen >= max) return false;
  await cache.put(key, new Response(String(seen + 1), { headers: { 'cache-control': 'max-age=90' } }));
  return true;
}
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

// ---------- the security service (GoPlus) ----------
// Asked only about a contract the phone's own lists and checks could not judge. The key lives here as a secret, never in the app.

/** A short-lived access token from the app key and secret (kept in storage until it runs out), or '' to ask without one. */
async function accessToken(env, fetchFn, now) {
  if (!env.GOPLUS_APP_KEY || !env.GOPLUS_APP_SECRET) return '';
  try {
    const kept = await env.LISTS.get('gp:token', 'json');
    if (kept && kept.until > now) return kept.token;
    const time = Math.floor(now / 1000);
    const sign = createHash('sha1').update(`${env.GOPLUS_APP_KEY}${time}${env.GOPLUS_APP_SECRET}`).digest('hex');
    const r = await fetchFn(`${GOPLUS}/api/v1/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_key: env.GOPLUS_APP_KEY, time, sign }), signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    const token = j?.result?.access_token;
    if (!r.ok || j?.code !== 1 || typeof token !== 'string') return '';
    await env.LISTS.put('gp:token', JSON.stringify({ token, until: now + Math.max(60, Number(j.result.expires_in ?? 3600) - 120) * 1000 }));
    return token;
  } catch {
    return '';
  }
}

async function goplus(path, env, fetchFn, now) {
  const call = async (token) => {
    const r = await fetchFn(`${GOPLUS}${path}`, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(12_000) });
    const j = await r.json().catch(() => null);
    return { ok: r.ok && j?.code === 1, j };
  };
  let res = await call(await accessToken(env, fetchFn, now));
  if (!res.ok) res = await call(''); // a bad or expired key must not switch the check off: ask without it
  return res.ok ? res.j.result : null;
}

/** Answer /risk/address and /risk/token, one contract at a time. Cached for hours so each contract costs one call. */
async function risk(kind, url, env, fetchFn, ctx, cache, who) {
  const chain = Number(url.searchParams.get('chain'));
  const addr = normAddress(url.searchParams.get('address') ?? '');
  if (!API_CHAINS.has(chain) || !addr) return json({ error: 'bad question' }, 400);
  const key = new Request(`https://cache.invalid/risk/${kind}/${chain}/${addr}`);
  const hit = cache ? await cache.match(key) : null;
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json', 'x-lokyx-cache': 'hit' } });
  const now = Date.now();
  if (cache && !((await allow(cache, `ip-${who}`, PER_PHONE_MIN, now)) && (await allow(cache, 'all', ALL_MIN, now)))) return json({ error: 'too many questions, try again soon' }, 429);
  const raw = await goplus(kind === 'address' ? `/api/v1/address_security/${addr}?chain_id=${chain}` : `/api/v1/token_security/${chain}?contract_addresses=${addr}`, env, fetchFn, Date.now());
  if (raw === null) return json({ error: 'the security service did not answer' }, 502);
  const body = JSON.stringify(kind === 'address' ? normAddressResult(raw) : normTokenResult(raw, addr));
  if (cache) {
    const put = cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ANSWER_TTL}` } }));
    ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  }
  return new Response(body, { headers: { 'content-type': 'application/json', 'x-lokyx-cache': 'miss' } });
}

/** The whole worker, with storage and the network passed in so it can be tested. */
export async function handle(request, env, fetchFn = fetch, ctx = undefined, cache = globalThis.caches?.default) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, '');
  if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
  if (p === '' || p === '/health') return json({ ok: true, name: 'lokyx-risk-relay' });
  if (p === '/lists/meta') {
    const meta = await env.LISTS.get('meta', 'json');
    return meta ? json(meta, 200, { 'cache-control': 'public, max-age=300' }) : json({ error: 'the lists are not built yet' }, 503);
  }
  if (p === '/lists/domains.bin' || p === '/lists/addresses.bin') {
    const body = await env.LISTS.get(p.slice('/lists/'.length), 'arrayBuffer');
    return body ? new Response(body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=3600' } }) : json({ error: 'not built yet' }, 503);
  }
  if (p === '/risk/address') return risk('address', url, env, fetchFn, ctx, cache, request.headers.get('cf-connecting-ip') ?? 'x');
  if (p === '/risk/token') return risk('token', url, env, fetchFn, ctx, cache, request.headers.get('cf-connecting-ip') ?? 'x');
  return json({ error: 'not found' }, 404);
}

export default {
  fetch: (request, env, ctx) => handle(request, env, fetch, ctx),
};
