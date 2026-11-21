// Scam lists, packed small and checked on the phone. Pure, so it is tested (test/risk-lists.test.ts); the relay worker
// (risk-relay/worker.mjs) imports this same file, so the phone and the relay can never disagree about the format.
//
// A list is a sorted run of 6-byte fingerprints: the first 6 bytes of sha256("d:<domain>") or sha256("a:<0x address>").
// 6 bytes keeps a 200,000-entry list near 1.2 MB, and the chance that an innocent name matches by accident is about
// one in a billion per check. The phone downloads the whole list and looks names up itself, so the relay never learns
// which site or contract anyone is looking at.

export const REC = 6;
export type Sha = (s: string) => Uint8Array;
export type Kind = 'd' | 'a';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A host name from a list entry, an origin or a full address; null when it is not one. */
export function normDomain(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  let s = x.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0].replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/^\*\./, '').replace(/\.$/, '');
  if (s.length < 4 || s.length > 253) return null;
  const labels = s.split('.');
  return labels.length >= 2 && labels.every((l) => LABEL.test(l)) ? s : null;
}

/** An Ethereum address in one form (0x + 40 lower-case hex), or null. */
export function normAddress(x: unknown): string | null {
  return typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x.trim()) ? x.trim().toLowerCase() : null;
}

/** The host and each parent of it, longest first, stopping before the last label: a.b.evil.com → a.b.evil.com, b.evil.com, evil.com. */
export function hostChain(host: string): string[] {
  const h = normDomain(host);
  if (!h) return [];
  const labels = h.split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

const rec = (sha: Sha, kind: Kind, v: string) => sha(`${kind}:${v}`).slice(0, REC);

const cmp = (a: Uint8Array, ao: number, b: Uint8Array): number => {
  for (let i = 0; i < REC; i++) if (a[ao + i] !== b[i]) return a[ao + i] - b[i];
  return 0;
};

/** The fingerprints of these names, sorted and without repeats. */
export function pack(sha: Sha, kind: Kind, values: Iterable<string>): Uint8Array {
  const seen = new Map<string, Uint8Array>();
  for (const v of values) {
    const r = rec(sha, kind, v);
    seen.set(Array.from(r, (b) => b.toString(16).padStart(2, '0')).join(''), r);
  }
  const out = new Uint8Array(seen.size * REC);
  [...seen.keys()].sort().forEach((k, i) => out.set(seen.get(k)!, i * REC));
  return out;
}

/** Is this name in the packed list? */
export function has(blob: Uint8Array, sha: Sha, kind: Kind, value: string): boolean {
  if (blob.length < REC || blob.length % REC) return false;
  const want = rec(sha, kind, value);
  let lo = 0;
  let hi = blob.length / REC - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cmp(blob, mid * REC, want);
    if (c === 0) return true;
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Is this site, or any parent of it, on the list? Takes an origin, a URL or a host. */
export function siteInList(blob: Uint8Array, sha: Sha, site: string): boolean {
  return hostChain(site).some((h) => has(blob, sha, 'd', h));
}

// ---------- reading the public lists (their shapes differ) ----------

const FIELDS = ['domain', 'url', 'host', 'id', 'name'];

/** The entries of a downloaded list: the array itself, or the array under the first of `pick` that is one. */
export function entries(json: unknown, pick: string[]): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') for (const k of pick) if (Array.isArray((json as Record<string, unknown>)[k])) return (json as Record<string, unknown[]>)[k];
  return [];
}

export function domainsFrom(json: unknown, pick: string[]): string[] {
  const out: string[] = [];
  for (const e of entries(json, pick)) {
    if (typeof e === 'string') {
      const d = normDomain(e);
      if (d) out.push(d);
    } else if (e && typeof e === 'object') {
      for (const f of FIELDS) {
        const d = normDomain((e as Record<string, unknown>)[f]);
        if (d) {
          out.push(d);
          break;
        }
      }
    }
  }
  return out;
}

export function addressesFrom(json: unknown, pick: string[]): string[] {
  const out: string[] = [];
  for (const e of entries(json, pick)) {
    const a = typeof e === 'string' ? normAddress(e) : e && typeof e === 'object' ? normAddress((e as Record<string, unknown>).address) : null;
    if (a) out.push(a);
  }
  return out;
}

// ---------- keeping a list in a text file ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
export function fromB64(s: string): Uint8Array {
  const t = s.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((t.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (const ch of t) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('Not base64.');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out.slice(0, o);
}

export interface Meta {
  /** when the lists were built (ms) */
  v: number;
  domains: number;
  addresses: number;
  sources: Record<string, { ok: boolean; count: number; at: number; error?: string }>;
}
export const metaOk = (m: unknown): m is Meta => !!m && typeof m === 'object' && typeof (m as Meta).v === 'number' && typeof (m as Meta).domains === 'number' && typeof (m as Meta).addresses === 'number';
