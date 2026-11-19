// What a swap costs. Pure, tested in test/swap-fees.test.ts.
//
// Instant swaps go through a partner (a quote, then one transaction): 0.5%. Direct swaps are atomic, between two
// people, with nobody holding the coins: 0.2%. These are the numbers the Swap tab shows before anyone slides.
// FEE_CHARGED says whether the wallet takes them yet. It does not: this is a test network, and the fee needs legal
// advice and audited swap contracts first. The tab says so beside every fee.

export type SwapMode = 'instant' | 'direct';

export const INSTANT_BPS = 50;
export const DIRECT_BPS = 20;
export const FEE_CHARGED = false;

export const bpsFor = (m: SwapMode) => (m === 'instant' ? INSTANT_BPS : DIRECT_BPS);

/** 50 -> "0.5%", 20 -> "0.2%", 100 -> "1%". */
export const percentText = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** The fee on `amount` (smallest units), rounded down so it is never more than the stated percentage. */
export const feeOn = (amount: bigint, bps: number): bigint => (amount <= 0n ? 0n : (amount * BigInt(bps)) / 10_000n);

export type SwapCoin = 'lyx' | 'btc' | 'eth' | 'sol' | 'trx';
export const SWAP_COINS: { id: SwapCoin; symbol: string; name: string; decimals: number }[] = [
  { id: 'lyx', symbol: 'LYX', name: 'LOKYX', decimals: 18 },
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
  { id: 'sol', symbol: 'SOL', name: 'Solana', decimals: 9 },
  { id: 'trx', symbol: 'TRX', name: 'Tron', decimals: 6 },
];

/** Whether the wallet can run a direct (atomic) swap for this pair today. Only LYX with Bitcoin and with Ethereum. */
export function directReady(a: SwapCoin, b: SwapCoin): boolean {
  if (a === b) return false;
  const s = [a, b].sort().join('+');
  return s === 'btc+lyx' || s === 'eth+lyx';
}

/** Turn what someone typed ("0.5", ".5", "1,000.25") into smallest units, or null if it is not a plain amount. */
export function toUnits(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) return null;
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0');
}

/** Smallest units back to text, trimmed ("1.5", not "1.500000"). */
export function fromUnits(v: bigint, decimals: number, maxFrac = decimals): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = a.toString().padStart(decimals + 1, '0');
  const w = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).slice(0, maxFrac).replace(/0+$/, '');
  return `${neg ? '-' : ''}${w}${f ? '.' + f : ''}`;
}

// Gift cards cost 0.2% to make, taken in the same coin as the card. Like the swap fees it is shown now and not
// collected on the test network. Collecting needs an address to pay it to, one per coin: until a coin has one
// below, nothing is asked for it, whatever FEE_CHARGED says.
export const GIFT_BPS = 20;
export const FEE_ADDRESS: Partial<Record<'lyx' | 'btc' | 'eth' | 'sol' | 'trx', string>> = {};

/** The fee for a card of `amount` (smallest units) in `coin`: zero while fees are off or the coin has no fee address. */
export const giftFee = (coin: keyof typeof FEE_ADDRESS, amount: bigint): bigint => (FEE_CHARGED && FEE_ADDRESS[coin] ? feeOn(amount, GIFT_BPS) : 0n);
