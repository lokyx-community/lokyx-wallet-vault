// What the Receive screen shows for a coin and a token, kept free of the screen so it can be tested.
import { requestUri, tokenRequestUri } from './scan-core.ts';
import { tapRequest, tapTokenRequest } from './tap-core.ts';

export type RecvChain = 'lyx' | 'btc' | 'eth' | 'sol' | 'trx';
export interface RecvToken {
  id: string;
  symbol: string;
  /** The token's contract (Ethereum-style chains) or mint (Solana, Tron). */
  contract?: string;
  decimals?: number;
}

/** What the QR holds. A token with no amount is just the address (so every wallet reads it); with an amount it is a request for that exact token. */
export function qrValue(p: { chain: RecvChain; address: string; token?: RecvToken; amount?: string; chainId?: number }): string {
  const { chain, address, token, amount, chainId } = p;
  if (chain === 'lyx') return `lokyx:${address}${amount ? `?amount=${amount}` : ''}`;
  if (chain === 'btc') return requestUri('btc', address, amount);
  if (chain === 'eth') {
    if (token?.contract && token.decimals !== undefined && chainId) return tokenRequestUri({ contract: token.contract, decimals: token.decimals, to: address, amount, chainId });
    return requestUri('eth', address, amount, chainId);
  }
  return address;
}

/** What a tapped phone is sent: the token itself when one is chosen, so a tapped token is never plain Ether. */
export function tapValue(p: { chain: RecvChain; address: string; token?: RecvToken; amount?: string; chainId?: number }): string {
  const { chain, address, token, amount, chainId } = p;
  if (chain === 'lyx') return tapRequest(address, amount);
  if (chain === 'eth' && token?.contract && chainId && !amount) return tapTokenRequest(token.contract, address, chainId);
  return qrValue(p);
}

/** An address as the card shows it: the start and the end, with the middle left out. */
export function shortCard(a: string): string {
  return a.length > 30 ? `${a.slice(0, 6)} … ${a.slice(-5)}` : a;
}

export interface DotLayout {
  n: number;
  /** Top-left cell of each of the three corner squares (each 7 cells wide). */
  eyes: [number, number][];
  /** Every other dark cell, in the round style. */
  dots: [number, number][];
  /** The empty square in the middle left for the coin mark: first cell, and how many cells wide. */
  hole: { from: number; size: number };
}

/** Splits a QR code's dark cells into corner squares (drawn rounded), round dots, and a hole for the coin's mark. The hole stays under a twentieth of the code, well inside what the code can lose and still scan. */
export function dotLayout(n: number, cells: [number, number][], withHole = true): DotLayout {
  const size = withHole ? (Math.round(n * 0.22) | 1) : 0;
  const from = Math.floor((n - size) / 2);
  const inEye = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const inHole = (x: number, y: number) => size > 0 && x >= from && x < from + size && y >= from && y < from + size;
  return {
    n,
    eyes: [[0, 0], [n - 7, 0], [0, n - 7]],
    dots: cells.filter(([x, y]) => !inEye(x, y) && !inHole(x, y)),
    hole: { from, size },
  };
}

/** Which card the screen was asked to open on: the coin asked for, or Ethereum when a token is asked for, else LOKYX. */
export function wantedId(coin?: string, token?: string): RecvChain {
  if (token) return 'eth';
  return coin === 'lyx' || coin === 'btc' || coin === 'eth' || coin === 'sol' || coin === 'trx' ? coin : 'lyx';
}

/** Where that card is in the list (the first card when it is not there). */
export function startIndex(ids: string[], coin?: string, token?: string): number {
  const i = ids.indexOf(wantedId(coin, token));
  return i < 0 ? 0 : i;
}
