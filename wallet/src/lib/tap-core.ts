// Tap to pay: the parts that need no phone, so they are tested (test/tap.test.ts). tap.ts adds Bluetooth.

/** Signal strength a phone must reach before its request is read. About -50 means almost touching. */
export const TAP_RSSI = -52;

export type TapState = 'idle' | 'starting' | 'broadcasting' | 'scanning' | 'near' | 'read';

/** What a person is shown for each thing that can go wrong, in plain words. */
export function tapProblem(reason: string): string {
  if (reason === 'permission') return 'Allow "Nearby devices" so the phones can find each other.';
  if (reason === 'off') return 'Turn Bluetooth on to tap.';
  if (reason === 'unsupported') return "This phone can't tap to pay.";
  if (reason === 'timeout' || reason === 'lost' || reason === 'service' || reason === 'read') return 'The phones lost each other. Hold them together again.';
  if (reason === 'payload') return 'That request is too long to tap.';
  return 'Tapping did not start. Try again.';
}

/** The text a phone holds out: the same link a QR code carries. */
export function tapRequest(address: string, amount?: string): string {
  return `lokyx:${address}${amount ? `?amount=${amount}` : ''}`;
}

/** A request for a token with no amount (EIP-681), so a tapped token is the token, not plain Ether. */
export function tapTokenRequest(contract: string, to: string, chainId: number): string {
  return `ethereum:${contract}@${chainId}/transfer?address=${to}`;
}

/** What the sender's screen calls the thing being asked for, from the request that arrived. */
export function tapAsk(f: { chain?: 'btc' | 'eth' | 'sol' | 'trx'; token?: string; capsule?: boolean; amount?: string }, tokenName?: string): string {
  const unit = f.token ? tokenName ?? 'a token' : f.chain === 'btc' ? 'BTC' : f.chain === 'eth' ? 'ETH' : f.chain === 'sol' ? 'SOL' : f.chain === 'trx' ? 'TRX' : 'LYX';
  return f.amount ? `${f.amount} ${unit}` : unit;
}
