// Safety rules that need no phone, so they are tested (test/guard.test.ts):
//   - new destinations wait before they can receive (the trusted list)
//   - a lower limit for the first two days after restoring on a new phone
//   - clearer address checks (block display, last-characters check, wider look-alike test)
//   - keeping the 24 words, the 12 recovery words and the safe address apart

const strip = (a: string) => a.trim().toLowerCase();

// ---------- trusted list: a new destination waits before it can receive ----------

export const TRUST_WAIT_MS = 24 * 3600_000;

/** address (lower case) -> when the person added it */
export type Trusted = Record<string, number>;

export type DestState =
  | { state: 'known' } // paid before, own account, or a contact: instant
  | { state: 'trusted' } // on the list and its wait is over
  | { state: 'waiting'; readyAt: number } // on the list, still waiting
  | { state: 'new' }; // never seen; it has to be added and wait

export interface DestInput {
  dest: string;
  /** addresses paid before, contacts and the person's own accounts */
  known: string[];
  trusted: Trusted;
  now: number;
  waitMs?: number;
}

export function destinationState(i: DestInput): DestState {
  const d = strip(i.dest);
  if (i.known.some((k) => strip(k) === d)) return { state: 'known' };
  const at = i.trusted[d];
  if (at === undefined) return { state: 'new' };
  const readyAt = at + (i.waitMs ?? TRUST_WAIT_MS);
  return i.now >= readyAt ? { state: 'trusted' } : { state: 'waiting', readyAt };
}

export const canPay = (s: DestState) => s.state === 'known' || s.state === 'trusted';

/** Add `dest` to the list. Adding it again never restarts the clock. */
export function addTrusted(t: Trusted, dest: string, now: number): Trusted {
  const d = strip(dest);
  return t[d] === undefined ? { ...t, [d]: now } : t;
}

export function removeTrusted(t: Trusted, dest: string): Trusted {
  const { [strip(dest)]: _gone, ...rest } = t;
  return rest;
}

/** "in 5 h 20 min", for the wait on screen. */
export function waitText(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 10) return `${r ? h + 1 : h} h`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * The protection itself can be turned off, but only after the same wait, so a thief holding an unlocked phone
 * cannot switch it off and send at once.
 */
export interface Protection {
  on: boolean;
  /** set when the person asked to turn it off; it takes effect at this time */
  offAt?: number;
}
export const DEFAULT_PROTECTION: Protection = { on: true };

export function protectionActive(p: Protection, now: number): boolean {
  if (!p.on) return false;
  return !(p.offAt !== undefined && now >= p.offAt);
}
export const requestOff = (p: Protection, now: number, waitMs = TRUST_WAIT_MS): Protection => (p.offAt !== undefined ? p : { ...p, offAt: now + waitMs });
export const cancelOff = (p: Protection): Protection => ({ on: true });

// ---------- a lower limit after restoring on a new phone ----------

export const NEW_DEVICE_MS = 48 * 3600_000;
/** During the window the most that can leave is this share of the biggest balance seen in it (1 in 10). */
export const NEW_DEVICE_SHARE = 10n;

export interface NewDevice {
  /** when the wallet was restored on this phone */
  since: number;
  /** per coin (chain and contract): the biggest balance seen, and what has left, in smallest units */
  peak: Record<string, string>;
  spent: Record<string, string>;
}

export const startNewDevice = (now: number): NewDevice => ({ since: now, peak: {}, spent: {} });
export const newDeviceActive = (n: NewDevice | null | undefined, now: number): n is NewDevice => !!n && now < n.since + NEW_DEVICE_MS;
export const newDeviceEnds = (n: NewDevice) => n.since + NEW_DEVICE_MS;

const big = (s: string | undefined) => (s && /^\d+$/.test(s) ? BigInt(s) : 0n);

/** What may still leave in the window for one coin, given the balance now. */
export function newDeviceRoom(n: NewDevice, asset: string, balance: bigint): bigint {
  const peak = big(n.peak[asset]) > balance ? big(n.peak[asset]) : balance;
  const cap = peak / NEW_DEVICE_SHARE;
  const left = cap - big(n.spent[asset]);
  return left > 0n ? left : 0n;
}

export type NewDeviceVerdict = { ok: true; next: NewDevice } | { ok: false; room: bigint; until: number };

/** Check a payment and, if it fits, return the record with it counted. Outside the window it always fits. */
export function newDeviceCheck(n: NewDevice | null | undefined, now: number, asset: string, balance: bigint, value: bigint): NewDeviceVerdict | { ok: true; next: null } {
  if (!newDeviceActive(n, now)) return { ok: true, next: null };
  const peak = big(n.peak[asset]) > balance ? big(n.peak[asset]) : balance;
  const room = newDeviceRoom(n, asset, balance);
  if (value > room) return { ok: false, room, until: newDeviceEnds(n) };
  return { ok: true, next: { ...n, peak: { ...n.peak, [asset]: peak.toString() }, spent: { ...n.spent, [asset]: (big(n.spent[asset]) + value).toString() } } };
}

// ---------- address checks ----------

/** An address in groups of four, so it can be compared piece by piece. The 0x / bc1 / lyx1 start is its own group. */
export function addressBlocks(addr: string): string[] {
  const a = addr.trim();
  const m = /^(0x|bc1|tb1|lyx1)/i.exec(a);
  const head = m ? m[0] : '';
  const body = a.slice(head.length);
  const out = head ? [head] : [];
  for (let i = 0; i < body.length; i += 4) out.push(body.slice(i, i + 4));
  return out;
}

/** The last characters the person is asked to type back. */
export const TAIL = 6;
export const tailOf = (addr: string) => addr.trim().slice(-TAIL);
export const tailMatches = (addr: string, typed: string) => typed.trim().length === TAIL && typed.trim().toLowerCase() === tailOf(addr).toLowerCase();

/**
 * How much an address deserves a second look.
 *  same      – exactly one the person has used
 *  lookalike – not the same but starts and ends like one they have (scammers copy the visible ends)
 *  new       – nothing like it in their history
 */
export type AddressRisk = { risk: 'same' } | { risk: 'lookalike'; imitates: string } | { risk: 'new' };

const prefixLen = (n: string) => (n.startsWith('0x') ? 2 : n.startsWith('bc1') || n.startsWith('tb1') ? 4 : n.startsWith('lyx1') ? 4 : 0);

export function addressRisk(dest: string, known: string[]): AddressRisk {
  const d = strip(dest);
  if (known.some((k) => strip(k) === d)) return { risk: 'same' };
  for (const k of known) {
    const n = strip(k);
    if (n === d) continue;
    // Phones show the first and last few characters, so match on 3 + 3 (wider than the old 4 + 4), across lengths too.
    const pre = prefixLen(n);
    if (prefixLen(d) !== pre) continue;
    if (n.slice(pre, pre + 3) === d.slice(pre, pre + 3) && n.slice(-3) === d.slice(-3)) return { risk: 'lookalike', imitates: k };
  }
  return { risk: 'new' };
}

// ---------- keeping the words apart ----------

/** What setup checks about a vault's safe address, given the address the 12 recovery words themselves make. */
export function safeAddressProblem(safe: string, o: { recoveryDerived: string; owner: string }): string | null {
  const s = strip(safe);
  if (!s) return 'Choose a safe address.';
  if (s === strip(o.recoveryDerived)) return 'This address comes from the same 12 words. Anyone who finds the words could send everything there. Use a different wallet.';
  if (s === strip(o.owner)) return 'The safe address has to be a different account from this one.';
  return null;
}

export const STORAGE_PLEDGES = [
  'I wrote the words on paper. I did not photograph them or save them in notes, email or the cloud.',
  'I will keep them in a different place from my 24 words.',
  'No one else can see where I keep them.',
] as const;

export const pledgeOk = (checked: boolean[]) => checked.length === STORAGE_PLEDGES.length && checked.every(Boolean);
