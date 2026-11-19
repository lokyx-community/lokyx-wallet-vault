// Importing another wallet and finding its money: the address styles other wallets use, and what we found. Pure rules.

export interface PathStyle {
  id: 'metamask' | 'ledger';
  label: string;
  path: (i: number) => string;
}

/** The two Ethereum-style layouts almost every wallet uses: MetaMask, Trust, Exodus and others (one account tree), and Ledger Live (one tree per account). */
export const PATH_STYLES: PathStyle[] = [
  { id: 'metamask', label: 'MetaMask style', path: (i) => `m/44'/60'/0'/0/${i}` },
  { id: 'ledger', label: 'Ledger Live style', path: (i) => `m/44'/60'/${i}'/0/0` },
];
/** How many accounts to look at in each style. */
export const SCAN_DEPTH = 3;

export function parsePrivateKey(text: string): `0x${string}` | null {
  const t = text.trim();
  const m = /^(?:0x)?([0-9a-fA-F]{64})$/.exec(t);
  return m ? (`0x${m[1].toLowerCase()}` as const) : null;
}

export const WORD_COUNTS = [12, 15, 18, 21, 24];
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const wordCountOk = (s: string) => WORD_COUNTS.includes(wordCount(s));

/** One thing found at an address. `amount` is in the coin's smallest unit. */
export interface Holding {
  net: string;
  symbol: string;
  contract?: string;
  decimals: number;
  amount: bigint;
}
export interface FoundAddress {
  /** which layout and account found it, e.g. "metamask 1" */
  from: string;
  style: PathStyle['id'] | 'key';
  address: string;
  holdings: Holding[];
}

/** The addresses to look at: both layouts, a few accounts each. One typed private key is a single address. */
export function scanTargets(depth = SCAN_DEPTH): { style: PathStyle['id']; index: number; path: string }[] {
  const out: { style: PathStyle['id']; index: number; path: string }[] = [];
  for (const s of PATH_STYLES) for (let i = 0; i < depth; i++) out.push({ style: s.id, index: i, path: s.path(i) });
  return out;
}

/** Drop addresses this wallet already owns, and the ones with nothing in them. */
export function onlyWithMoney(found: FoundAddress[], own: string[]): FoundAddress[] {
  const mine = new Set(own.map((a) => a.toLowerCase()));
  return found.filter((f) => !mine.has(f.address.toLowerCase()) && f.holdings.some((h) => h.amount > 0n));
}

export const styleLabel = (id: FoundAddress['style']) => (id === 'key' ? 'Private key' : PATH_STYLES.find((s) => s.id === id)!.label);
