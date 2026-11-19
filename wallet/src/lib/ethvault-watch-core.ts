// Which things in an Ethereum vault deserve an alert. Pure, so it is tested (test/ethvault.test.ts).
// Two kinds: a queued transaction this phone didn't start, and a live setting that is not what was set up.

import { describeCall, diffConfig, itemState, type Expected, type Issue, type KnownToken, type Live, type QueuedItem } from './ethvault-core.ts';

export interface EthAlert {
  /** stable, so each item alerts once */
  key: string;
  net: string;
  kind: 'queued' | 'config';
  level: 'warn' | 'danger';
  text: string;
  /** queued items: seconds since epoch when it can run, and its place in the Delay queue */
  readyAt?: number;
  nonce?: bigint;
}

export const startedKey = (net: string, nonce: bigint) => `eth:${net}:${nonce}`;

export function ethAlerts(
  net: string, netLabel: string, live: Live, expected: Expected, items: QueuedItem[], started: { has(k: string): boolean }, now: number, tokens: KnownToken[] = [],
): EthAlert[] {
  const out: EthAlert[] = [];
  for (const i of items) {
    if (itemState(i, now, live.delay.txNonce) === 'cancelled' || itemState(i, now, live.delay.txNonce) === 'expired') continue;
    if (started.has(startedKey(net, i.nonce))) continue;
    const d = describeCall(i, tokens, { safe: expected.safe });
    out.push({ key: `eth:${net}:q:${i.nonce}:${i.txHash}`, net, kind: 'queued', level: d.level === 'normal' ? 'warn' : d.level, text: `${netLabel}: ${d.line}`, readyAt: i.readyAt, nonce: i.nonce });
  }
  // only the unexpected-setting issues here; "N item(s) are waiting" is already covered by the queue above
  for (const s of diffConfig(expected, live)) {
    if (/item\(s\) are waiting/.test(s.text)) continue;
    out.push({ key: `eth:${net}:c:${s.text}`, net, kind: 'config', level: s.level, text: `${netLabel}: ${s.text}` });
  }
  return out;
}

export type { Issue };
