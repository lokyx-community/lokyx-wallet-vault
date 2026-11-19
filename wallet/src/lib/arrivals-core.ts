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
