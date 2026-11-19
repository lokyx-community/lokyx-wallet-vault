/** Pure parts of the one "Add a token" screen: which network an address belongs to, and how to describe what was found. */
export type TokenChain = 'lyx' | 'eth' | 'sol' | 'trx';
export const TOKEN_CHAINS: TokenChain[] = ['lyx', 'eth', 'sol', 'trx'];
export const CHAIN_NAME: Record<TokenChain, string> = { lyx: 'LOKYX', eth: 'Ethereum', sol: 'Solana', trx: 'Tron' };

export const asChain = (v: unknown): TokenChain => (TOKEN_CHAINS as unknown[]).includes(v) ? (v as TokenChain) : 'eth';

/** Each network writes addresses its own way, so a pasted address says where it lives. Null when it fits none. */
export function guessChain(text: string): TokenChain | null {
  const t = text.trim();
  if (/^lyx1[02-9ac-hj-np-z]{6,}$/i.test(t)) return 'lyx';
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return 'eth';
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(t)) return 'trx';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return 'sol';
  return null;
}

export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

export interface Verdict { tone: 'good' | 'warn' | 'bad'; title: string; text: string }
/** A token that is on the app's list is a known one; anything else could carry any name, so the person confirms it. */
export function verdictFor(known: string | null, lookalike: string | null = null): Verdict {
  if (!known && lookalike) return { tone: 'bad', title: `Not the real ${lookalike}`, text: 'It uses the name of a well-known coin, but its address is not the real one. Copies like this are a common scam.' };
  return known
    ? { tone: 'good', title: 'Known token', text: `${known} is on the wallet's list.` }
    : { tone: 'warn', title: 'Nobody has reviewed it', text: 'Anyone can make a token with any name. Check the address with whoever gave it to you.' };
}

/** Known stablecoins wear their own colour; every other token stays graphite, like any coin that isn't in the wallet. */
export const cardKindFor = (known: string | null, symbol: string): 'usdc' | 'usdt' | 'gr' => {
  if (!known) return 'gr';
  const s = symbol.toUpperCase();
  return s === 'USDC' ? 'usdc' : s === 'USDT' ? 'usdt' : 'gr';
};

/** Add stays off until there is a token, and an unreviewed one also needs the person's tick. */
export const canAdd = (found: boolean, known: string | null, checked: boolean) => found && (!!known || checked);
