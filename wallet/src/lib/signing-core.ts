// Signing protection: before the wallet signs something a website asks for, read it and stop the ones that drain a wallet.
// Pure and tested (test/signing.test.ts). It never signs anything; it only sorts a request into three:
//
//   allow   a fixed amount, ending soon, to a spender the person knows. Slide to sign.
//   review  something unusual but not a drain. The person has to read it and tick a box first.
//   stop    a combination that empties wallets. There is no "sign anyway": the person rejects, or turns protection
//           off in Settings (which takes 24 hours, see guard-core.ts).
//
// What counts as a drain is a COMBINATION: handing someone the right to take more than you meant, with no end, at an
// address nobody has vouched for. A fixed, short permit to a known app is the everyday case and is not interrupted.

import { decodeCall } from './contract-check-core.ts';

/** One right being handed over: "this address may take up to `amount` of `token`, until `endsAt`". */
export interface Grant {
  type: 'allowance' | 'permit' | 'all';
  /** the token (or collection) contract, lower case, when the request names it */
  token?: string;
  spender: string;
  /** base units; undefined when the request does not carry one (setApprovalForAll) */
  amount?: bigint;
  /** the amount is so large it means "everything, now and later" */
  unlimited: boolean;
  /** when the right ends, in ms; null = it never does; undefined = the request has no end of its own (a plain approve) */
  endsAt?: number | null;
}

export type Request =
  | { kind: 'send'; to: string | null; data: string; value?: bigint }
  | { kind: 'typed'; json: string }
  | { kind: 'sign'; message: string };

export interface Decoded {
  grants: Grant[];
  /** the request changes who controls an account (owner, signer or delegate) */
  ownerChange: boolean;
  newOwner?: string;
  /** an order that can sell assets (Seaport and the like) */
  order: boolean;
  /** the wallet could not read it into words */
  unreadable: boolean;
  /** the typed-data type, for the title */
  typeName?: string;
}

const MAX_SAFE_AMOUNT = 1n << 159n; // no real token has this many base units, so a request this big means "all of it"
const YEAR_MS = 365 * 24 * 3600_000;
const lc = (a: string) => a.toLowerCase();
const isAddr = (a: unknown): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Permit2: the shared allowance contract. Approving a token to it is the normal first step of many apps. */
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';

const num = (v: unknown): bigint | null => {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return BigInt(Math.trunc(v));
    if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) return BigInt(v.trim());
  } catch {
    /* not a number */
  }
  return null;
};

/** A deadline in seconds from a request, as ms or null (never). 0 is how Permit2 and DAI write "no end". */
function endOf(v: unknown): number | null | undefined {
  const n = num(v);
  if (n == null) return undefined;
  if (n === 0n) return null;
  if (n >= 1n << 47n) return null; // far beyond any date that matters
  return Number(n) * 1000;
}

const word = (data: string, i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
const addrOf = (w: string) => `0x${w.slice(24)}`.toLowerCase();

const OWNER_SELECTORS: Record<string, number> = {
  '0xf2fde38b': 0, // transferOwnership(newOwner)
  '0x0d582f13': 0, // Safe addOwnerWithThreshold(owner, threshold)
  '0xe318b52b': 2, // Safe swapOwner(prev, old, new)
  '0x13af4035': 0, // setOwner(newOwner)
};

function fromCall(to: string | null, data: string): Decoded {
  const out: Decoded = { grants: [], ownerChange: false, order: false, unreadable: false };
  const sel = data.slice(0, 10).toLowerCase();
  if (sel in OWNER_SELECTORS && /^0x[0-9a-fA-F]*$/.test(data) && data.length >= 10 + 64 * (OWNER_SELECTORS[sel] + 1)) {
    out.ownerChange = true;
    out.newOwner = addrOf(word(data, OWNER_SELECTORS[sel]));
    return out;
  }
  const c = decodeCall(data);
  const hex = /^0x[0-9a-fA-F]*$/.test(data);
  const token = to && isAddr(to) ? lc(to) : undefined;
  if (c.kind === 'approve' && c.spender && hex) {
    const amount = BigInt(`0x${word(data, 1)}`);
    out.grants.push({ type: 'allowance', token, spender: lc(c.spender), amount, unlimited: amount >= MAX_SAFE_AMOUNT });
  } else if (c.kind === 'approveAll' && c.spender) {
    if (c.grantAll) out.grants.push({ type: 'all', token, spender: lc(c.spender), unlimited: true });
  } else if (c.kind === 'permit' && c.spender && hex) {
    // permit(owner, spender, value, deadline, v, r, s)
    const amount = BigInt(`0x${word(data, 2)}`);
    out.grants.push({ type: 'permit', token, spender: lc(c.spender), amount, unlimited: amount >= MAX_SAFE_AMOUNT, endsAt: endOf(`0x${word(data, 3)}`) });
  }
  return out;
}

function details(d: unknown): { token?: string; amount: bigint | null; expiration?: unknown }[] {
  const list = Array.isArray(d) ? d : d && typeof d === 'object' ? [d] : [];
  return list.map((x) => {
    const o = x as Record<string, unknown>;
    return { token: isAddr(o.token) ? lc(o.token) : undefined, amount: num(o.amount), expiration: o.expiration };
  });
}

function fromTyped(json: string): Decoded {
  const out: Decoded = { grants: [], ownerChange: false, order: false, unreadable: false };
  let t: { domain?: Record<string, unknown>; primaryType?: string; message?: Record<string, unknown> };
  try {
    t = JSON.parse(json);
  } catch {
    return { ...out, unreadable: true };
  }
  const type = String(t?.primaryType ?? '');
  const m = (t?.message ?? {}) as Record<string, unknown>;
  out.typeName = type || undefined;
  if (!type || typeof m !== 'object') return { ...out, unreadable: true };
  const contract = isAddr(t.domain?.verifyingContract) ? lc(t.domain!.verifyingContract as string) : undefined;

  if (/delegat|authoriz|setowner|changeowner|transferownership/i.test(type) && !/^permit/i.test(type)) {
    out.ownerChange = true;
    const who = m.delegate ?? m.delegatee ?? m.newOwner ?? m.owner ?? m.address;
    if (isAddr(who)) out.newOwner = lc(who);
    return out;
  }
  if (/^order|seaport|orderComponents/i.test(type)) {
    out.order = true;
    return out;
  }
  if (type === 'Permit' && isAddr(m.spender)) {
    if (m.allowed !== undefined) {
      // DAI-style: permit(holder, spender, nonce, expiry, allowed)
      if (m.allowed === false || m.allowed === 'false') return out;
      out.grants.push({ type: 'permit', token: contract, spender: lc(m.spender), unlimited: true, endsAt: endOf(m.expiry) });
      return out;
    }
    const amount = num(m.value);
    out.grants.push({ type: 'permit', token: contract, spender: lc(m.spender), amount: amount ?? undefined, unlimited: amount != null && amount >= MAX_SAFE_AMOUNT, endsAt: endOf(m.deadline) });
    return out;
  }
  if (/^Permit(Single|Batch)$/.test(type) && isAddr(m.spender)) {
    const end = endOf(m.sigDeadline);
    for (const d of details(m.details)) {
      const e = endOf(d.expiration);
      // the allowance ends at its own expiration; the signature itself ends at sigDeadline. The later one is how long it lives.
      const ends = e === null || end === null ? null : e !== undefined && end !== undefined ? Math.max(e, end) : (e ?? end);
      out.grants.push({ type: 'permit', token: d.token, spender: lc(m.spender), amount: d.amount ?? undefined, unlimited: d.amount != null && d.amount >= MAX_SAFE_AMOUNT, endsAt: ends });
    }
    if (!out.grants.length) out.unreadable = true;
    return out;
  }
  if (/^Permit(Batch)?(Witness)?TransferFrom$/.test(type) && isAddr(m.spender)) {
    const end = endOf(m.deadline);
    for (const d of details(m.permitted)) out.grants.push({ type: 'permit', token: d.token, spender: lc(m.spender), amount: d.amount ?? undefined, unlimited: d.amount != null && d.amount >= MAX_SAFE_AMOUNT, endsAt: end });
    if (!out.grants.length) out.unreadable = true;
    return out;
  }
  out.unreadable = true;
  return out;
}

export function decodeRequest(req: Request): Decoded {
  if (req.kind === 'typed') return fromTyped(req.json);
  if (req.kind === 'send') return !req.data || req.data === '0x' ? { grants: [], ownerChange: false, order: false, unreadable: false } : fromCall(req.to, req.data);
  return { grants: [], ownerChange: false, order: false, unreadable: false };
}

/** The addresses that have to be looked up (is there code there?) before this can be judged. */
export function partiesOf(d: Decoded): string[] {
  const s = new Set<string>();
  for (const g of d.grants) s.add(g.spender);
  if (d.newOwner) s.add(d.newOwner);
  return [...s];
}

export type Level = 'allow' | 'review' | 'stop';
export type ReasonCode = 'owner' | 'noCode' | 'unlimitedNew' | 'neverNew' | 'allNew' | 'unlimited' | 'never' | 'newSpender' | 'order' | 'unreadable';
export interface Reason {
  code: ReasonCode;
  text: string;
}
export type Code = 'contract' | 'none' | 'unknown';

export interface Ctx {
  now: number;
  /** is protection on right now (guard-core protectionActive) */
  protectionOn: boolean;
  /** addresses the person knows: contacts, paid before, own accounts. Lower case. */
  known: string[];
  /** what a lookup of the address found. Missing = not looked up (treated as unknown). */
  code: Record<string, Code>;
  /** a token's name for the screen; the short address when it is not known */
  tokenName?: (token: string | undefined) => string;
}

export interface Assessment {
  level: Level;
  /** protection was off, so nothing was judged */
  skipped: boolean;
  headline: string;
  /** one line under the headline */
  sub?: string;
  reasons: Reason[];
  /** the grant the screen draws (the most dangerous one) */
  main?: Grant;
  token: string;
  amountText: string;
  endsText: string;
  /** the one-line reason shown at the bottom of the sheet */
  why: string;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "In 30 minutes", "In 2 hours", "In 3 days", "Never". */
export function endsText(endsAt: number | null | undefined, now: number): string {
  if (endsAt === undefined) return 'Until used';
  if (endsAt === null || endsAt - now > YEAR_MS) return 'Never';
  const ms = endsAt - now;
  if (ms <= 0) return 'Already ended';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `In ${Math.max(1, min)} minute${min === 1 ? '' : 's'}`;
  const h = Math.round(ms / 3600_000);
  if (h < 48) return `In ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(ms / 86_400_000);
  return `In ${d} days`;
}

const severity = (g: Grant, known: boolean, code: Code, now: number): number => {
  const never = g.endsAt === null || (g.endsAt != null && g.endsAt - now > YEAR_MS);
  return (code === 'none' ? 8 : 0) + (g.unlimited ? 4 : 0) + (never ? 2 : 0) + (known ? 0 : 1);
};

/**
 * Judge a request. With protection off nothing is judged (`skipped`), so the ordinary sheet runs as before.
 * `decoded` comes from decodeRequest and `ctx.code` from looking up partiesOf(decoded).
 */
export function assess(req: Request, decoded: Decoded, ctx: Ctx): Assessment {
  const name = (t?: string) => (ctx.tokenName ? ctx.tokenName(t) : t ? shortAddr(t) : 'tokens');
  const base = { reasons: [] as Reason[], token: '', amountText: '', endsText: '', why: '' };
  if (!ctx.protectionOn) return { level: 'allow', skipped: true, headline: '', ...base };

  const known = new Set([...ctx.known.map(lc), PERMIT2]);
  const reasons: Reason[] = [];
  let level = 'allow' as Level;
  const raise = (l: Level) => {
    if (l === 'stop' || (l === 'review' && level === 'allow')) level = l;
  };

  if (decoded.ownerChange) {
    reasons.push({ code: 'owner', text: 'It hands control of an account to another address.' });
    return { level: 'stop', skipped: false, headline: 'This would hand over your account', sub: 'Nobody who is helping you needs this.', reasons, token: '', amountText: 'Control', endsText: 'Until you take it back', why: 'It gives another address control of an account.' };
  }

  let main: Grant | undefined;
  let mainScore = -1;
  for (const g of decoded.grants) {
    // Approving a token to Permit2 is the normal first step of many apps. What Permit2 may then move is limited by each signature.
    if (g.spender === PERMIT2 && g.type === 'allowance') continue;
    const isKnown = known.has(g.spender);
    const code = ctx.code[g.spender] ?? 'unknown';
    const never = g.endsAt === null || (g.endsAt != null && g.endsAt - ctx.now > YEAR_MS);
    const sc = severity(g, isKnown, code, ctx.now);
    if (sc > mainScore) (main = g), (mainScore = sc);
    if (code === 'none') {
      reasons.push({ code: 'noCode', text: 'The address that gets this is a plain account with no public code.' });
      raise('stop');
    } else if (g.type === 'all' && !isKnown) {
      reasons.push({ code: 'allNew', text: 'It gives an unknown address the right to take every item in a collection.' });
      raise('stop');
    } else if (g.unlimited && !isKnown) {
      reasons.push({ code: 'unlimitedNew', text: 'It asks for every one of these tokens, now and later, for an address with no history.' });
      raise('stop');
    } else if (never && !isKnown) {
      reasons.push({ code: 'neverNew', text: 'It never ends, and the address is brand new.' });
      raise('stop');
    } else if (g.unlimited || g.type === 'all') {
      reasons.push({ code: 'unlimited', text: 'It asks for every one of these tokens. The app is known, but a limit would be safer.' });
      raise('review');
    } else if (never) {
      reasons.push({ code: 'never', text: 'It never ends. Ask the app for a short one.' });
      raise('review');
    } else if (!isKnown) {
      reasons.push({ code: 'newSpender', text: 'You have not used this address before.' });
      raise('review');
    } else if (code === 'unknown') {
      // looked up and could not tell; a known app with a fixed amount is still fine
    }
  }
  if (decoded.order) {
    reasons.push({ code: 'order', text: 'It is an order that can sell items from your wallet.' });
    raise('review');
  }
  if (decoded.unreadable && req.kind !== 'send') {
    reasons.push({ code: 'unreadable', text: 'The wallet could not turn this into words.' });
    raise('review');
  }

  const tok = main ? name(main.token) : 'tokens';
  const amountText = !main ? '' : main.unlimited ? 'Everything' : main.amount == null ? 'Everything' : main.amount.toString();
  const ends = main ? endsText(main.endsAt, ctx.now) : '';
  let headline = 'Review this signature';
  let sub: string | undefined;
  const typed = req.kind === 'typed';
  if (main) {
    if (level === 'stop') {
      headline = main.unlimited || main.type === 'all' ? (main.type === 'all' ? 'This lets someone take all your collectibles' : `This could take all your ${tok}`) : typed ? `This signature lets someone take your ${tok}` : `This lets someone spend your ${tok}`;
      sub = typed ? 'Signing is free, but it works like a payment later.' : undefined;
    } else {
      headline = `Let ${shortAddr(main.spender)} use ${main.unlimited ? `all your ${tok}` : tok}`;
    }
  }
  const why = level === 'allow' ? 'Known app, fixed amount, short time.' : reasons[0]?.text ?? '';
  return { level, skipped: false, headline, sub, reasons, main, token: tok, amountText, endsText: ends, why };
}

// ---------- the switch: on, or off after a wait. It reuses the same wait as the new-address list. ----------
export { DEFAULT_PROTECTION, protectionActive, requestOff, cancelOff } from './guard-core.ts';
export type { Protection } from './guard-core.ts';
