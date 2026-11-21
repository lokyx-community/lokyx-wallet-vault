// Builds the packed scam lists. This is too heavy for a Cloudflare free-plan Worker (10 ms of CPU per run), so it runs on your own
// server (build-lists.mjs) and the Worker only hands the finished files to phones.

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

