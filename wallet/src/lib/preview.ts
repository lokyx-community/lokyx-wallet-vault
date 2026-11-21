// The preview of a request, from the node: what would leave and what would arrive, with each token's name and size.
// The numbers come only from a test run on the node; if it cannot run one, this says "unavailable".

import { ensureApps } from './appswallet';
import { activeNets, ensurePrimary, ethSimulate, lookupToken } from './multichain';
import { toPreview, type Move, type Preview } from './preview-core';
import type { EthNet } from './multichain-core';

export interface Shown extends Move {
  symbol: string;
  decimals: number;
}
export type ShownPreview = { state: 'unavailable' } | { state: 'ready'; reverted: boolean; reason?: string; out: Shown[]; in: Shown[] };

const known = new Map<string, { symbol: string; decimals: number }>();
async function describe(net: EthNet, m: Move, unit: string): Promise<Shown> {
  if (m.token === 'native') return { ...m, symbol: unit, decimals: 18 };
  if (m.nft || m.id !== undefined) return { ...m, symbol: 'NFT', decimals: 0 };
  const k = `${net}:${m.token}`;
  let t = known.get(k);
  if (!t) {
    try {
      const x = await lookupToken(net, m.token);
      t = { symbol: x.symbol, decimals: x.decimals };
      known.set(k, t);
    } catch {
      t = { symbol: '', decimals: 0 };
    }
  }
  return { ...m, ...t };
}

/** Run the request on the node and name what moves. Never throws: any failure is "unavailable". */
export async function previewSend(ask: { to: string | null; value: bigint; data: string; index: number }, unit: string): Promise<{ raw: Preview; shown: ShownPreview }> {
  try {
    const net = activeNets().eth;
    const from = ask.index ? await ensureApps() : (await ensurePrimary()).eth;
    const raw = toPreview(await ethSimulate(net, from, ask.to, ask.data, ask.value), from);
    if (raw.state !== 'ready') return { raw, shown: { state: 'unavailable' } };
    const [out, inn] = await Promise.all([Promise.all(raw.out.map((m) => describe(net, m, unit))), Promise.all(raw.in.map((m) => describe(net, m, unit)))]);
    return { raw, shown: { state: 'ready', reverted: raw.reverted, reason: raw.reason, out, in: inn } };
  } catch {
    return { raw: { state: 'unavailable' }, shown: { state: 'unavailable' } };
  }
}
