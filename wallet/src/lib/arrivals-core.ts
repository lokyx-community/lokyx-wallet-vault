/** Which balances went up since the last look: those are money that arrived. A key is one coin on one network at one address. */
export interface Arrival { key: string; delta: bigint }

export function arrivals(prev: Record<string, bigint> | null, now: Record<string, bigint>): Arrival[] {
  if (!prev) return [];
  const out: Arrival[] = [];
  for (const k of Object.keys(now)) {
    const before = prev[k];
    // a coin or network that was not there before is a switch, not a deposit
    if (before !== undefined && now[k] > before) out.push({ key: k, delta: now[k] - before });
  }
  return out;
}

/**
 * True when the balance on hand was read from this network. After a switch the hook still holds the previous network's
 * number until the new one loads; filing that under the new network would show a deposit that never happened.
 */
export const readFrom = (loaded: Record<string, string>, coin: string, net: string): boolean => loaded[coin] === net;
