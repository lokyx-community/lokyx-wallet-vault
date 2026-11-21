// Ask the security service (GoPlus, through the risk relay) about one contract or token. Used only for things the wallet's own
// lists and checks could not judge. The relay and GoPlus see the contract address, nothing else. Never throws: no answer is null.

import { riskBase } from './risk-lists';
import { API_CHAINS, type ApiVerdict } from './risk-api-core';
import { normAddress } from './risk-lists-core';

const memo = new Map<string, { at: number; v: ApiVerdict | null }>();
const KEEP = 6 * 3600_000;
const KEEP_MISS = 5 * 60_000;

export const apiCovers = (chainId: number) => API_CHAINS.has(chainId);

export async function askRisk(kind: 'address' | 'token', chainId: number, address: string): Promise<ApiVerdict | null> {
  const a = normAddress(address);
  if (!a || !API_CHAINS.has(chainId)) return null;
  const k = `${kind}:${chainId}:${a}`;
  const m = memo.get(k);
  if (m && Date.now() - m.at < (m.v ? KEEP : KEEP_MISS)) return m.v;
  let v: ApiVerdict | null = null;
  try {
    const base = await riskBase();
    if (base) {
      const r = await fetch(`${base}/risk/${kind}?chain=${chainId}&address=${a}`, { signal: AbortSignal.timeout(8_000) });
      const j = (await r.json()) as Partial<ApiVerdict>;
      if (r.ok && j && typeof j.level === 'string' && Array.isArray(j.flags)) v = { level: j.level as ApiVerdict['level'], flags: j.flags.map(String), source: 'goplus' };
    }
  } catch {
    /* offline, or the relay or the service is down: no answer */
  }
  memo.set(k, { at: Date.now(), v });
  return v;
}
