// LOKYX risk relay: builds one small shared copy of the public scam lists for every phone.
// It downloads the public lists on a schedule, boils them down to fingerprints (src/lib/risk-lists-core.ts) and hands the
// same packed file to every phone. The phone checks names itself, so this relay never learns which site or contract anyone
// looked at. It holds no accounts, keeps no logs of who asks, and has no keys in this file.

import { createHash } from 'node:crypto';
import { addressesFrom, domainsFrom, normAddress, pack } from '../src/lib/risk-lists-core.ts';
import { API_CHAINS, normAddressResult, normTokenResult } from '../src/lib/risk-api-core.ts';

const sha = (s) => new Uint8Array(createHash('sha256').update(s).digest());
const RAW = 'https://raw.githubusercontent.com';

/** Public lists. A wrong address here shows up as `ok: false` for that source in /lists/meta; the others still work. */
export const SOURCES = [
  { name: 'metamask-phishing', kind: 'd', url: `${RAW}/MetaMask/eth-phishing-detect/main/src/config.json`, pick: ['blocklist', 'blacklist'] },
  { name: 'scamsniffer-domains', kind: 'd', url: `${RAW}/scamsniffer/scam-database/main/blacklist/domains.json`, pick: ['domains', 'blacklist'] },
  { name: 'scamsniffer-addresses', kind: 'a', url: `${RAW}/scamsniffer/scam-database/main/blacklist/address.json`, pick: ['addresses', 'address'] },
  { name: 'mew-urls', kind: 'd', url: `${RAW}/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json`, pick: [] },
  { name: 'mew-addresses', kind: 'a', url: `${RAW}/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json`, pick: [] },
];

const MAX_BYTES = 40_000_000;
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

/**
 * Download every source, keep each source's own last good copy, and build the two packed lists.
 * A source that fails, comes back empty, or shrinks to less than half of what it was is treated as broken: its last good copy
 * is kept, so one bad day upstream (or a bad edit) can never empty the list a phone relies on.
 */
export async function refresh(env, fetchFn = fetch, now = Date.now()) {
  const prev = (await env.LISTS.get('meta', 'json')) ?? { sources: {} };
  const union = { d: new Set(), a: new Set() };
  const sources = {};
  for (const s of SOURCES) {
    const before = prev.sources?.[s.name];
    let items = null;
    let error = '';
    try {
      const r = await fetchFn(s.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (text.length > MAX_BYTES) throw new Error('too large');
      const got = s.kind === 'd' ? domainsFrom(JSON.parse(text), s.pick) : addressesFrom(JSON.parse(text), s.pick);
      const old = before?.count ?? 0;
      if (!got.length) throw new Error('nothing in it');
      if (old > 200 && got.length < old / 2) throw new Error(`shrank from ${old} to ${got.length}`);
      items = got;
    } catch (e) {
      error = e instanceof SyntaxError ? 'not JSON' : String(e?.message ?? e).slice(0, 120);
    }
    if (items) {
      await env.LISTS.put(`src:${s.name}`, JSON.stringify(items));
      sources[s.name] = { ok: true, count: items.length, at: now };
    } else {
      items = (await env.LISTS.get(`src:${s.name}`, 'json')) ?? [];
      sources[s.name] = { ok: false, count: items.length, at: before?.at ?? 0, error };
    }
    for (const i of items) union[s.kind].add(i);
  }
  const domains = pack(sha, 'd', union.d);
  const addresses = pack(sha, 'a', union.a);
  // never publish an empty list over a good one
  if (!domains.length && !addresses.length && prev.v) return { ...prev, kept: true };
  await env.LISTS.put('domains.bin', domains);
  await env.LISTS.put('addresses.bin', addresses);
  const meta = { v: now, domains: domains.length / 6, addresses: addresses.length / 6, sources };
  await env.LISTS.put('meta', JSON.stringify(meta));
  return meta;
}

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
  if (request.method === 'POST' && p === '/admin/refresh') {
    // optional: only works if you set an ADMIN_KEY secret; lets you refresh by hand right after deploying
    if (!env.ADMIN_KEY || request.headers.get('x-admin') !== env.ADMIN_KEY) return json({ error: 'no' }, 403);
    return json(await refresh(env, fetchFn));
  }
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
  scheduled: (_event, env, ctx) => ctx.waitUntil(refresh(env)),
};
