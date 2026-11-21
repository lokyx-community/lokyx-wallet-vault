// LOKYX risk relay: builds one small shared copy of the public scam lists for every phone.
// It downloads the public lists on a schedule, boils them down to fingerprints (src/lib/risk-lists-core.ts) and hands the
// same packed file to every phone. The phone checks names itself, so this relay never learns which site or contract anyone
// looked at. It holds no accounts, keeps no logs of who asks, and has no keys in this file.

import { createHash } from 'node:crypto';
import { addressesFrom, domainsFrom, pack } from '../src/lib/risk-lists-core.ts';

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

/** The whole worker, with storage and the network passed in so it can be tested. */
export async function handle(request, env, fetchFn = fetch) {
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
  return json({ error: 'not found' }, 404);
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (_event, env, ctx) => ctx.waitUntil(refresh(env)),
};
