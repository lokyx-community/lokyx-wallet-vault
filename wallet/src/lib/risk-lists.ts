// Scam lists on the phone: download the packed lists from the risk relay (risk-relay/README.md), keep them in two files,
// and check sites and addresses here. Nothing about what the person looks at is ever sent anywhere.

import { File, Paths } from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { blockedSites } from './data';
import { REC, fromB64, has, hostChain, metaOk, normAddress, normDomain, siteInList, toB64, type Meta } from './risk-lists-core';

/** Where the risk relay lives. Put its https address here after deploying it (risk-relay/README.md). Empty means "no public lists". */
export const DEFAULT_RISK = 'https://lokyx-risk.lokyx.workers.dev';
const EVERY = 6 * 3600_000;

const sha = (s: string) => sha256(utf8ToBytes(s));
let domains = new Uint8Array(0);
let addrs = new Uint8Array(0);
export const riskInfo = store<{ v: number; domains: number; addresses: number }>({ v: 0, domains: 0, addresses: 0 });
export const useRiskInfo = () => useStore(riskInfo);

const file = (name: string) => new File(Paths.document, `lokyx-risk-${name}.b64`);

export async function riskBase(): Promise<string> {
  let v = DEFAULT_RISK;
  try {
    const s = ((await getItem('w.riskUrl')) ?? '').trim().replace(/\/+$/, '');
    if (/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(s)) v = s;
  } catch {}
  return v.replace(/\/+$/, '');
}

/** Read the lists kept from last time. Never throws: with nothing kept, the public-list check simply has nothing to say yet. */
export async function loadRisk(): Promise<void> {
  try {
    const d = file('domains');
    const a = file('addresses');
    if (d.exists && a.exists) {
      const dd = fromB64(await d.text());
      const aa = fromB64(await a.text());
      if (dd.length % REC === 0 && aa.length % REC === 0) {
        domains = dd;
        addrs = aa;
        const m = JSON.parse((await getItem('w.riskmeta')) ?? 'null');
        riskInfo.set({ v: metaOk(m) ? m.v : 0, domains: dd.length / REC, addresses: aa.length / REC });
      }
    }
  } catch {}
}

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`risk relay answered ${r.status}`);
  return r;
}

/** Fetch newer lists if the relay has any (at most every 6 hours). Never throws and never blocks the app. */
export async function refreshRisk(force = false): Promise<void> {
  try {
    const url = await riskBase();
    if (!url) return;
    const last = Number((await getItem('w.riskcheck')) ?? 0);
    if (!force && Date.now() - last < EVERY) return;
    const meta = (await (await get(`${url}/lists/meta`)).json()) as Meta;
    if (!metaOk(meta)) return;
    await setItem('w.riskcheck', String(Date.now()));
    if (meta.v === riskInfo.get().v) return;
    const dd = new Uint8Array(await (await get(`${url}/lists/domains.bin`)).arrayBuffer());
    const aa = new Uint8Array(await (await get(`${url}/lists/addresses.bin`)).arrayBuffer());
    // only believe a download that is the size the relay said it is
    if (dd.length % REC || aa.length % REC || dd.length / REC !== meta.domains || aa.length / REC !== meta.addresses) return;
    for (const [name, bytes] of [['domains', dd], ['addresses', aa]] as const) {
      const f = file(name);
      if (f.exists) f.delete();
      f.write(toB64(bytes));
    }
    await setItem('w.riskmeta', JSON.stringify({ v: meta.v, domains: meta.domains, addresses: meta.addresses, sources: meta.sources }));
    domains = dd;
    addrs = aa;
    riskInfo.set({ v: meta.v, domains: meta.domains, addresses: meta.addresses });
  } catch {
    /* offline or the relay is down: keep what we have */
  }
}

export type SiteRisk = 'you' | 'list' | null;

/** Why this website should not be trusted: the person blocked it ("you"), or it is on a public scam list ("list"). */
export function siteRisk(site: string): SiteRisk {
  const chain = hostChain(site);
  if (!chain.length) return null;
  if (blockedSites.get().some((h) => chain.includes(h))) return 'you';
  return siteInList(domains, sha, site) ? 'list' : null;
}

/** Is this address on a public scam list? */
export function addressRisk(a: string | null | undefined): boolean {
  const n = normAddress(a ?? '');
  return !!n && has(addrs, sha, 'a', n);
}

export async function blockSite(site: string): Promise<void> {
  const h = normDomain(site);
  if (h) await blockedSites.save((l) => (l.includes(h) ? l : [h, ...l]));
}
/** Stop blocking a site, and every parent of it you had blocked. */
export async function unblockSite(site: string): Promise<void> {
  const chain = hostChain(site);
  await blockedSites.save((l) => l.filter((h) => !chain.includes(h)));
}
