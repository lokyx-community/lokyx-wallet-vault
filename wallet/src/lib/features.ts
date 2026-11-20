// Switches for things that exist as code. Anything off here is not user-facing yet.
// Swap, buy and usage counts are off. Predict is on for the test network only (play money). Turning a flag on is a deliberate, reviewed change.

export const FEATURES = {
  /** In-app swaps through a partner. No provider is wired in. */
  swap: false,
  /** Buy crypto with a card or bank (an on-ramp). No provider is wired in. */
  buy: false,
  /** Anonymous usage counts (see usage-core.ts). Designed, off, and sends nothing. */
  usageCounts: false,
  /** Prediction markets (BNB Chain with USDT, LOKYX chain with LYX). On for the test network only: play money, no real value. */
  predict: true,
} as const;

export type Feature = keyof typeof FEATURES;
export const enabled = (f: Feature) => FEATURES[f];
