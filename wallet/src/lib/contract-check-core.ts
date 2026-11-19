// Before a website's contract call is signed: what the call does, whether the contract's source is public, whether
// it is on our short list of contracts with a known audit, and what to say about it. Pure and tested.
//
// What this can and cannot tell you (the screen says the same):
//  - "Verified" means the source code on a public explorer (Blockscout or Sourcify) compiles to the code on chain.
//    It lets anyone read it. It does not mean the code is safe.
//  - "Audited" is not on the blockchain. It only means a published review is known for that exact address, from the
//    list below. A contract that is not on the list may be fine; it just is not known here.
//  - Nothing here replaces reading what you sign. It makes unknown things stop and ask.

const MAX = (1n << 256n) - 1n;

export type CallKind = 'none' | 'approve' | 'approveAll' | 'permit' | 'transfer' | 'bundle' | 'swap' | 'other';
export interface DecodedCall {
  kind: CallKind;
  /** the name the function is known by, e.g. "approve" */
  name?: string;
  selector?: string;
  /** who is given the right to spend (approve, setApprovalForAll, permit, increaseAllowance) */
  spender?: string;
  unlimited?: boolean;
  /** setApprovalForAll(…, true) */
  grantAll?: boolean;
  bytes: number;
}

// Common functions by their 4-byte selector.
const SELECTORS: Record<string, { name: string; kind: CallKind }> = {
  '0x095ea7b3': { name: 'approve', kind: 'approve' },
  '0x39509351': { name: 'increaseAllowance', kind: 'approve' },
  '0xa22cb465': { name: 'setApprovalForAll', kind: 'approveAll' },
  '0xd505accf': { name: 'permit', kind: 'permit' },
  '0xa9059cbb': { name: 'transfer', kind: 'transfer' },
  '0x23b872dd': { name: 'transferFrom', kind: 'transfer' },
  '0x42842e0e': { name: 'safeTransferFrom', kind: 'transfer' },
  '0xb88d4fde': { name: 'safeTransferFrom', kind: 'transfer' },
  '0x40c10f19': { name: 'mint', kind: 'other' },
  '0x2e1a7d4d': { name: 'withdraw', kind: 'other' },
  '0xd0e30db0': { name: 'deposit', kind: 'other' },
  '0x3593564c': { name: 'execute (Uniswap router)', kind: 'swap' },
  '0x38ed1739': { name: 'swapExactTokensForTokens', kind: 'swap' },
  '0x7ff36ab5': { name: 'swapExactETHForTokens', kind: 'swap' },
  '0xac9650d8': { name: 'multicall', kind: 'bundle' },
  '0x5ae401dc': { name: 'multicall', kind: 'bundle' },
  '0x8d80ff0a': { name: 'multiSend', kind: 'bundle' },
  '0x6a761202': { name: 'execTransaction (Safe)', kind: 'bundle' },
};

const word = (data: string, i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
const addrOf = (w: string) => `0x${w.slice(24)}`;

/** What a transaction's data asks for, in the cases that matter. Anything not known is `other`. */
export function decodeCall(data: string | undefined): DecodedCall {
  if (!data || data === '0x') return { kind: 'none', bytes: 0 };
  const bytes = Math.max(0, (data.length - 2) / 2);
  const selector = data.slice(0, 10).toLowerCase();
  const s = SELECTORS[selector];
  if (!s || bytes < 4) return { kind: 'other', selector: bytes >= 4 ? selector : undefined, bytes };
  const base: DecodedCall = { kind: s.kind, name: s.name, selector, bytes };
  const hex = /^0x[0-9a-fA-F]*$/.test(data);
  if (hex && s.kind === 'approve' && data.length >= 10 + 128) {
    const amount = BigInt(`0x${word(data, 1)}`);
    return { ...base, spender: addrOf(word(data, 0)), unlimited: amount >= MAX / 2n };
  }
  if (hex && s.kind === 'approveAll' && data.length >= 10 + 128) {
    const on = BigInt(`0x${word(data, 1)}`) !== 0n;
    return { ...base, spender: addrOf(word(data, 0)), grantAll: on };
  }
  if (hex && s.kind === 'permit' && data.length >= 10 + 64 * 3) {
    // permit(owner, spender, value, deadline, v, r, s)
    const amount = BigInt(`0x${word(data, 2)}`);
    return { ...base, spender: addrOf(word(data, 1)), unlimited: amount >= MAX / 2n };
  }
  return base;
}

/** An EIP-1167 minimal proxy: a tiny contract that forwards everything to another. */
export const isMinimalProxy = (code: string) => /^0x363d3d373d3d3d363d73[0-9a-fA-F]{40}5af43d82803e903d91602b57fd5bf3/i.test(code);

// ---------- contracts with a known audit ----------

export interface AuditEntry {
  name: string;
  by: string;
}
const A = (name: string, by: string): AuditEntry => ({ name, by });
// Address lists come from the Safe and Zodiac deployment packages (see ETH_VAULT.md). Deterministic addresses are
// the same on every network, so these are matched by address alone.
const AUDITED_RAW: [string, AuditEntry][] = [
  ['0x29fcB43b46531BcA003ddC8FCB67FFE91900C762', A('Safe L2 v1.4.1', 'Ackee Blockchain')],
  ['0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67', A('Safe proxy factory v1.4.1', 'Ackee Blockchain')],
  ['0x9641d764fc13c8B624c04430C7356C1C7C8102e2', A('Safe MultiSendCallOnly v1.4.1', 'Ackee Blockchain')],
  ['0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99', A('Safe fallback handler v1.4.1', 'Ackee Blockchain')],
  ['0xAA46724893dedD72658219405185Fb0Fc91e091C', A('Safe Allowance module v0.1.1', 'Safe, Ackee Blockchain')],
  ['0xd54895B1121A2eE3f37b502F507631FA1331BED6', A('Zodiac Delay modifier v1.0.1', 'G0 Group')],
  ['0xD8DfC1d938D7D163C5231688341e9635E9011889', A('Zodiac Roles modifier v1', 'G0 Group')],
];
const AUDITED = new Map(AUDITED_RAW.map(([a, e]) => [a.toLowerCase(), e]));
export const auditOf = (address: string): AuditEntry | null => AUDITED.get(address.toLowerCase()) ?? null;

// ---------- reading what the explorers say ----------

export type Source = 'verified' | 'unverified' | 'unknown';
export interface SourceInfo {
  source: Source;
  name?: string;
  proxy: boolean;
}

/** Blockscout /api/v2/smart-contracts/<address>. A 404 means it knows no source for that address. */
export function parseBlockscout(status: number, json: unknown): SourceInfo {
  if (status === 404) return { source: 'unverified', proxy: false };
  if (status < 200 || status >= 300 || !json || typeof json !== 'object') return { source: 'unknown', proxy: false };
  const j = json as { is_verified?: unknown; is_fully_verified?: unknown; name?: unknown; proxy_type?: unknown; implementations?: unknown };
  const verified = j.is_verified === true || j.is_fully_verified === true;
  return {
    source: verified ? 'verified' : 'unverified',
    name: typeof j.name === 'string' && j.name ? j.name : undefined,
    proxy: (typeof j.proxy_type === 'string' && j.proxy_type !== '' && j.proxy_type !== 'unknown') || (Array.isArray(j.implementations) && j.implementations.length > 0),
  };
}

/** Sourcify /server/v2/contract/<chain>/<address>: 200 with a match, or 404. */
export function parseSourcify(status: number, json: unknown): SourceInfo {
  if (status === 404) return { source: 'unverified', proxy: false };
  if (status < 200 || status >= 300 || !json || typeof json !== 'object') return { source: 'unknown', proxy: false };
  const m = (json as { match?: unknown }).match;
  return { source: m === 'match' || m === 'exact_match' ? 'verified' : 'unverified', proxy: false };
}

/** Two services, either one saying "verified" is enough. Both saying "no" is a no. Anything else is "unknown". */
export function combineSources(list: SourceInfo[]): SourceInfo {
  const yes = list.find((x) => x.source === 'verified');
  const proxy = list.some((x) => x.proxy);
  const name = list.find((x) => x.name)?.name;
  if (yes) return { source: 'verified', name, proxy };
  if (list.length && list.every((x) => x.source === 'unverified')) return { source: 'unverified', name, proxy };
  return { source: 'unknown', name, proxy };
}

// ---------- the verdict ----------

export interface Party {
  role: 'contract' | 'spender';
  address: string;
  /** null when the network could not be asked */
  isContract: boolean | null;
  source: Source;
  proxy: boolean;
  name?: string;
  audit: AuditEntry | null;
}
export type Level = 'ok' | 'caution' | 'danger';
export interface Verdict {
  level: Level;
  headline: string;
  /** plain sentences, most important first */
  reasons: string[];
  /** the review step must be opened and ticked before the slide unlocks */
  review: boolean;
}

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/** One party's state in words, and how bad it is: 0 fine, 1 unclear, 2 bad. */
function partyNote(p: Party): { text: string; score: 0 | 1 | 2 } {
  const who = p.role === 'spender' ? 'The address that would get the right to spend' : 'The contract';
  const label = `${p.name ? `${p.name} (${short(p.address)})` : short(p.address)}`;
  if (p.isContract === false) return { text: `${who} ${label} is an ordinary address, not a contract.`, score: p.role === 'spender' ? 2 : 1 };
  if (p.audit) return { text: `${who} ${label} is ${p.audit.name}, reviewed by ${p.audit.by}.${p.proxy ? ' It is upgradeable.' : ''}`, score: 0 };
  if (p.source === 'unverified') return { text: `${who} ${label} has no public source code. Nobody outside its authors can read what it does.`, score: 2 };
  if (p.source === 'unknown') return { text: `${who} ${label}: whether its source code is public could not be checked.`, score: 1 };
  return {
    text: `${who} ${label} has public source code, but no audit is known for it.${p.proxy ? ' It is a proxy, so its owner can swap the code later.' : ''}`,
    score: 1,
  };
}

export function judge(call: DecodedCall, parties: Party[], toIsNew: boolean, valueWei: bigint): Verdict {
  const reasons: string[] = [];
  let bad = 0; // 2 = something that should stop the user
  let unclear = 0;

  if (toIsNew) {
    reasons.push('This creates a new contract. Nobody has checked the code it will run.');
    bad = 2;
  }
  if (call.kind === 'approveAll' && call.grantAll) {
    reasons.push('It lets this address move ALL of your tokens in this collection, not just one. This is how most wallet drains work.');
    bad = 2;
  } else if ((call.kind === 'approve' || call.kind === 'permit') && call.unlimited) {
    reasons.push('The approval is unlimited: that address can take every one of these tokens, now and later, until you cancel it.');
    unclear = Math.max(unclear, 1);
  }
  if (call.kind === 'bundle') {
    reasons.push('This is a bundle of several actions in one signature. The wallet cannot show you each one, so only continue if the site is one you know.');
    unclear = Math.max(unclear, 1);
  }
  if (call.kind === 'other' && !call.name) {
    reasons.push('The wallet does not recognise this function, so it cannot tell you what it does.');
    unclear = Math.max(unclear, 1);
  }

  let allKnown = parties.length > 0;
  for (const p of parties) {
    const n = partyNote(p);
    reasons.push(n.text);
    if (n.score === 2) bad = 2;
    if (n.score >= 1) allKnown = false;
    unclear = Math.max(unclear, n.score);
  }

  const asks = call.kind === 'approve' || call.kind === 'approveAll' || call.kind === 'permit';
  let level: Level = bad === 2 && (asks || toIsNew || parties.some((p) => p.source === 'unverified' && p.isContract !== false)) ? 'danger' : bad === 2 || unclear >= 1 ? 'caution' : 'ok';
  if (level === 'ok' && !allKnown && (call.kind !== 'none' || valueWei > 0n) && parties.length) level = 'caution';

  const headline =
    level === 'danger' ? 'Stop and read this first' : level === 'caution' ? 'No review on record' : 'Known and reviewed contract';
  if (level === 'ok') reasons.push('Reviewed does not mean risk-free. Check that the site and the amount are what you expected.');
  else reasons.push('An audit or verified source is not a promise of safety. If you are not sure, reject: nothing is lost by saying no.');
  return { level, headline, reasons, review: level !== 'ok' };
}
