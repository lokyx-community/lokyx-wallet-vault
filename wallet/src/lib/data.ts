// Things the wallet remembers on this phone: tokens you follow, people you pay, payments still
// waiting for a block, and the websites you've let see your address.

import { switchHooks } from './ns';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { rpc, type RunResult, type TxInfo } from './rpc';
import { currentAddress } from './wallet';

function saved<T>(key: string, initial: T) {
  const s = store<T>(initial);
  let loaded = false;
  switchHooks.push(async () => {
    loaded = false;
    s.set(initial);
    const raw = await getItem(key);
    loaded = true;
    if (raw) s.set(JSON.parse(raw));
  });
  return {
    ...s,
    async load() {
      if (loaded) return;
      loaded = true;
      const raw = await getItem(key);
      if (raw) s.set(JSON.parse(raw));
    },
    async save(next: T | ((v: T) => T)) {
      s.set(next);
      await setItem(key, JSON.stringify(s.get()));
    },
  };
}

// ---------- tokens ----------

export interface Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export const tokens = saved<Token[]>('w.tokens', []);
export const useTokens = () => useStore(tokens);

/** Reads a token contract's name, symbol and decimals. Throws if it isn't a token. */
export async function readToken(address: string): Promise<Token> {
  const call = (method: string) => rpc<RunResult>('lyx_call', { to: address, method, args: [] });
  const [n, s, d] = await Promise.all([call('name'), call('symbol'), call('decimals')]);
  if (!n.ok || !s.ok) throw new Error("That contract isn't a token");
  return { address, name: String(n.result), symbol: String(s.result), decimals: Number(d.ok ? d.result : 18) };
}

export async function tokenBalance(t: Token, who: string): Promise<bigint> {
  const r = await rpc<RunResult>('lyx_call', { to: t.address, method: 'balance_of', args: [who] });
  if (!r.ok) return 0n;
  return amountOf(r.result);
}

export function formatUnits(v: bigint, decimals: number, maxFrac = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  const w = whole.toLocaleString('en-US');
  return frac ? `${w}.${frac}` : w;
}

export function parseUnits(s: string, decimals: number): bigint {
  const t = s.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') throw new Error('Enter an amount like 1.25');
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** Contract ABIs write amounts as decimal text with 18 places ("1.5"); this is the base units. */
export const amountOf = (v: unknown) => parseUnits(String(v ?? '0').replace(/,/g, '') || '0', 18);
/** Base units as the decimal text contract ABIs expect. */
export const amountText = (v: bigint) => formatUnits(v, 18, 18).replace(/,/g, '');

// ---------- contacts ----------

export interface Contact {
  name: string;
  address: string;
}
export const contacts = saved<Contact[]>('w.contacts', []);
export const useContacts = () => useStore(contacts);
export const contactFor = (address: string) => contacts.get().find((c) => c.address === address);

/** Addresses you've paid lately, newest first. */
export const recent = saved<string[]>('w.recent', []);
export const useRecent = () => useStore(recent);
export const rememberRecent = (a: string) => recent.save((r) => [a, ...r.filter((x) => x !== a)].slice(0, 12));

// ---------- payments waiting for a block ----------

export interface Pending {
  hash: string;
  from: string;
  to: string;
  amount: string; // display text, like "12.5 LYX"
  what: 'send' | 'call' | 'deploy' | 'token';
  at: number;
}
export const pending = saved<Pending[]>('w.pending', []);
export const usePending = () => useStore(pending).filter((p) => p.from === currentAddress());
export const addPending = (p: Pending) => pending.save((x) => [p, ...x]);

/** Drops the ones that made it into a block, or that the network forgot about. */
export async function settlePending() {
  const list = pending.get();
  if (!list.length) return;
  const keep: Pending[] = [];
  for (const p of list) {
    try {
      const t = await rpc<TxInfo>('lyx_getTransaction', { hash: p.hash });
      if (t.status === 'pending') keep.push(p);
    } catch {
      if (Date.now() - p.at < 10 * 60_000) keep.push(p);
    }
  }
  if (keep.length !== list.length) await pending.save(keep);
}

// ---------- websites ----------

export interface Site {
  origin: string;
  name: string;
  address: string;
  at: number;
}
export const sites = saved<Site[]>('w.sites', []);
export const useSites = () => useStore(sites);
export const isConnected = (origin: string, address: string) => sites.get().some((s) => s.origin === origin && s.address === address);
/** Websites allowed to see the Ethereum address (window.ethereum), kept apart from the LOKYX-chain ones. */
export const evmSites = saved<Site[]>('w.evmsites', []);
export const useEvmSites = () => useStore(evmSites);
export const isEvmConnected = (origin: string, address: string) => evmSites.get().some((s) => s.origin === origin && s.address.toLowerCase() === address.toLowerCase());

// ---------- savings jars ----------

export interface Jar {
  owner: string;
  name: string;
  unlock: number;
  start?: number;
  /** set once the deploy is in a block */
  address?: string;
  tx: string;
  at: number;
}
export const jars = saved<Jar[]>('w.jars', []);

/** A shared (multisig) LYX account this phone is an owner of. `address` is empty until the deploy is mined. */
export interface SharedAcct {
  name: string;
  address: string;
  tx?: string;
  at: number;
}
export const shared = saved<SharedAcct[]>('w.shared', []);
export const useShared = () => useStore(shared);
/** Offers this phone posted on the board, so it can watch for answers. */
export interface BoardPost {
  id: number;
  tx?: string;
  swap: string;
  at: number;
}
/** Tokens locked away until a height (contracts/tokenlock). `address` is empty until the deploy lands; `funded` once the tokens went in. */
export interface TokenLock {
  token: string;
  symbol: string;
  amount: string;
  to: string;
  unlock: number;
  tx: string;
  address: string;
  funded: boolean;
  at: number;
}
export const tokenLocks = saved<TokenLock[]>('w.tokenlocks', []);
export const useTokenLocks = () => useStore(tokenLocks);
export const boardPosts = saved<BoardPost[]>('w.boardposts', []);
export const useBoardPosts = () => useStore(boardPosts);
export const useJars = () => useStore(jars).filter((j) => j.owner === currentAddress());

/** Fills in the contract address of jars and tokens whose deploy has landed since. */
export async function resolveDeploy(tx: string): Promise<string | null> {
  try {
    const t = await rpc<TxInfo>('lyx_getTransaction', { hash: tx });
    if (t.status !== 'confirmed') return null;
    if (t.receipt && !t.receipt.ok) return '';
    return t.receipt?.contract ?? (t.contract?.kind === 'deploy' ? t.contract.address : null) ?? null;
  } catch {
    return null;
  }
}

export async function loadAll() {
  await Promise.all([tokens.load(), contacts.load(), recent.load(), pending.load(), sites.load(), jars.load(), shared.load(), boardPosts.load(), tokenLocks.load()]);
}

/** Forget everything in memory too, after the wallet is removed from the phone. */
export function resetData() {
  tokens.set([]);
  contacts.set([]);
  recent.set([]);
  pending.set([]);
  sites.set([]);
  jars.set([]);
  shared.set([]);
  boardPosts.set([]);
  tokenLocks.set([]);
}
