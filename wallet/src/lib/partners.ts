// Where a swap or buy-crypto partner plugs in later. Only the shapes are here: no provider is wired in,
// the features are hidden behind FEATURES.swap / FEATURES.buy, and nothing collects a fee. A partner
// module would implement one of these interfaces and be registered in `register…Provider` below.

import { FEATURES } from './features.ts';

export interface Asset {
  /** chain id (EVM), "btc", or "lyx" */
  chain: string;
  /** Token contract address / token id, never a bare symbol. Empty for the chain's own coin. */
  id: string;
  symbol: string;
  decimals: number;
}

export interface SwapQuote {
  from: Asset;
  to: Asset;
  /** base units */
  amountIn: bigint;
  amountOut: bigint;
  /** What the person pays the partner, if anything. This wallet adds nothing on top. */
  providerFee: bigint;
  expiresAt: number;
  /** The exact transaction(s) the person would sign, shown in words before signing. */
  steps: { chain: string; description: string }[];
}

export interface SwapProvider {
  readonly name: string;
  pairs(): Promise<[Asset, Asset][]>;
  quote(from: Asset, to: Asset, amountIn: bigint, account: string): Promise<SwapQuote>;
  /** Returns what to sign; signing and clear-signing stay in the wallet. */
  prepare(q: SwapQuote): Promise<{ unsigned: unknown }>;
  status(id: string): Promise<'pending' | 'done' | 'failed'>;
}

export interface OnRampQuote {
  fiat: string;
  fiatAmount: number;
  asset: Asset;
  assetAmount: bigint;
  providerFee: number;
}

export interface OnRampProvider {
  readonly name: string;
  countries(): Promise<string[]>;
  quote(fiat: string, fiatAmount: number, asset: Asset): Promise<OnRampQuote>;
  /** A URL the person opens in the provider's own page to pay; the wallet only supplies the address. */
  checkoutUrl(q: OnRampQuote, destination: string): Promise<string>;
}

let swap: SwapProvider | null = null;
let ramp: OnRampProvider | null = null;

export function registerSwapProvider(p: SwapProvider) {
  swap = p;
}
export function registerOnRampProvider(p: OnRampProvider) {
  ramp = p;
}
/** null unless the feature flag is on AND a provider was registered. */
export const swapProvider = (): SwapProvider | null => (FEATURES.swap ? swap : null);
export const onRampProvider = (): OnRampProvider | null => (FEATURES.buy ? ramp : null);
