// Deciding which waiting vault items and key rotations deserve an alert. Pure, so it is tested
// (test/watch.test.ts). The background task in watch.ts feeds it what the node says.

import type { Account, HistoryItem } from './rpc.ts';

export interface Alert {
  /** Stable key, so each item alerts once. */
  key: string;
  account: string;
  kind: 'withdraw' | 'update' | 'close' | 'heir' | 'rotation';
  releaseHeight: number;
  text: string;
  /** Pending item id (tx hash) when it can be cancelled by id; rotations cancel by account. */
  id?: string;
}

/** Hashes (and rotation keys) of things this phone started, so it doesn't alert about its own actions. */
export type Started = { has(k: string): boolean };

export const rotationKey = (account: string, newKey: string) => `rot:${account}:${newKey}`;
const strip = (h: string) => h.replace(/^0x/, '').toLowerCase();

/** Everything waiting on `accts` that this phone didn't start. */
export function findAlerts(accts: Account[], started: Started, short: (a: string) => string = (a) => a): Alert[] {
  const out: Alert[] = [];
  for (const a of accts) {
    for (const p of a.vault?.pending ?? []) {
      if (started.has(strip(p.id))) continue;
      const kind = p.byHeir ? 'heir' : p.kind;
      const text =
        kind === 'heir' ? `An heir has started to claim ${short(a.address)}`
        : kind === 'withdraw' ? `A withdrawal of ${p.amountLyx ?? '?'} LYX to ${short(p.to ?? '')} is waiting`
        : kind === 'update' ? `A change to the settings of ${short(a.address)} is waiting`
        : `Closing the vault ${short(a.address)} is waiting`;
      out.push({ key: `p:${strip(p.id)}`, account: a.address, kind, releaseHeight: p.releaseHeight, text, id: strip(p.id) });
    }
    const r = a.pendingRotation;
    if (r && !started.has(rotationKey(a.address, r.newKey))) {
      out.push({ key: `${rotationKey(a.address, r.newKey)}:${r.releaseHeight}`, account: a.address, kind: 'rotation', releaseHeight: r.releaseHeight, text: `The key of ${short(a.address)} is being rotated to ${short(r.newKey)}` });
    }
  }
  return out;
}

/** Alerts not yet told to the person. */
export const fresh = (alerts: Alert[], told: Set<string>) => alerts.filter((a) => !told.has(a.key));

/** Drop remembered keys that no longer exist, so the set doesn't grow forever. */
export const prune = (told: Set<string>, alerts: Alert[]) => new Set([...told].filter((k) => alerts.some((a) => a.key === k)));

/**
 * Where a server-side watchtower plugs in later: it would hold a cancel authorisation the person signs
 * once (never the key itself) and use it while the phone is off. Nothing here talks to a server.
 */
export interface Watchtower {
  readonly name: string;
  /** Tell the tower to watch `account` and which alert kinds it may cancel. */
  register(account: string, opts: { cancelKinds: Alert['kind'][] }): Promise<void>;
  unregister(account: string): Promise<void>;
}

export const noWatchtower: Watchtower = {
  name: 'none',
  async register() {},
  async unregister() {},
};

// ---------- money coming in ----------


export const receiptKey = (account: string, i: Pick<HistoryItem, 'txHash' | 'blockHash'>) => `rx:${account}:${strip(i.txHash ?? i.blockHash)}`;

/** Payments received into `account` that haven't been told yet. Mining rewards are not announced (one per block). */
export function newReceipts(account: string, items: HistoryItem[], seen: { has(k: string): boolean }): HistoryItem[] {
  return items.filter((i) => i.kind === 'received' && !seen.has(receiptKey(account, i)));
}

export const sendKey = (account: string, i: Pick<HistoryItem, 'txHash' | 'blockHash'>) => `tx:${account}:${strip(i.txHash ?? i.blockHash)}`;

/** Payments that left `account` and haven't been told yet: a spending alert, wherever they were sent from. */
export function newSends(account: string, items: HistoryItem[], seen: { has(k: string): boolean }): HistoryItem[] {
  return items.filter((i) => i.kind === 'sent' && !seen.has(sendKey(account, i)));
}

/** How much a balance went down since last time (0n when it didn't, or on the first look). */
export function balanceDrop(prev: string | undefined, now: bigint): bigint {
  if (prev === undefined || !/^\d+$/.test(prev)) return 0n;
  const p = BigInt(prev);
  return now < p ? p - now : 0n;
}

/** How much a Bitcoin or Ethereum balance went up since last time (0n when it didn't, or on the first look). */
export function balanceRise(prev: string | undefined, now: bigint): bigint {
  if (prev === undefined || !/^\d+$/.test(prev)) return 0n;
  const p = BigInt(prev);
  return now > p ? now - p : 0n;
}
