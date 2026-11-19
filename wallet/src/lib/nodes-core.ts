// Which nodes the wallet will believe. Pure rules, tested in test/nodes.test.ts.
//
// A node is only used after it shows the right network: the chain id the wallet expects, and the same
// genesis hash as every other node it has trusted. The first genesis hash seen on the expected chain id
// is remembered (a "pin"); a node on any other chain, or a fork with a different genesis, is refused.

export interface NodeEntry {
  url: string;
  label: string;
  /** Shipped with the app: cannot be removed. */
  builtin?: boolean;
}

export interface Pin {
  chainId: number;
  genesisHash: string;
}

export type Vet = { ok: true; pin: Pin } | { ok: false; reason: string };

export function vetNode(info: { chainId?: number; genesisHash?: string }, expectChainId: number, pin: Pin | null): Vet {
  if (typeof info.chainId !== 'number') return { ok: false, reason: "That doesn't look like a LOKYX node." };
  if (info.chainId !== expectChainId) return { ok: false, reason: `That node is on a different network (chain ${info.chainId}, this wallet uses ${expectChainId}).` };
  // lokyxd prints hashes as plain hex (no 0x); accept both and keep one form so pins compare equal
  const raw = (info.genesisHash ?? '').toLowerCase();
  const g = /^[0-9a-f]{64}$/.test(raw) ? `0x${raw}` : raw;
  if (!/^0x[0-9a-f]{64}$/.test(g)) return { ok: false, reason: 'That node did not say which chain it started from.' };
  if (pin && pin.chainId === expectChainId && pin.genesisHash !== g) return { ok: false, reason: 'That node started from a different genesis block: it is a different chain.' };
  return { ok: true, pin: { chainId: expectChainId, genesisHash: g } };
}

/** Normalises what a person typed. */
export function cleanUrl(s: string): string | null {
  const u = s.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/i.test(u) ? u : null;
}

/** Active node first, then the rest, skipping any marked down recently. */
export function order(list: NodeEntry[], active: string, downUntil: Record<string, number>, now: number): NodeEntry[] {
  const up = (n: NodeEntry) => (downUntil[n.url] ?? 0) <= now;
  const first = list.find((n) => n.url === active);
  const rest = list.filter((n) => n.url !== active);
  return [...(first ? [first] : []), ...rest].sort((a, b) => Number(!up(a)) - Number(!up(b)) || 0);
}

export type Sync = 'synced' | 'behind' | 'stale';

/** Is a node keeping up? Behind the best known height by a few blocks, or its tip is old. */
export function syncState(h: { height: number; bestTimestamp: number }, bestHeight: number, blockTime: number, nowSecs: number): Sync {
  if (nowSecs - h.bestTimestamp > blockTime * 20) return 'stale';
  return bestHeight - h.height > 3 ? 'behind' : 'synced';
}
