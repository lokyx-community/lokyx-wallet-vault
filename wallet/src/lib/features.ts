// Switches for things that exist as code but are not turned on. Nothing here is user-facing yet.
// Every flag is false in this build; a release that turns one on is a deliberate, reviewed change.

export const FEATURES = {
  /** In-app swaps through a partner. No provider is wired in. */
  swap: false,
  /** Buy crypto with a card or bank (an on-ramp). No provider is wired in. */
  buy: false,
  /** Anonymous usage counts (see usage-core.ts). Designed, off, and sends nothing. */
  usageCounts: false,
} as const;

export type Feature = keyof typeof FEATURES;
export const enabled = (f: Feature) => FEATURES[f];
