// Watchtowers, the alert-only kind: a small server that watches a vault and tells you on every device you list when
// something you did not start is waiting. It holds no key and cannot move or cancel anything. Cancelling for you while
// the phone is off needs "cancel tickets" in the chain, which do not exist yet (docs/DESIGN.md), so that part waits.
//
// Pure logic for the phone and for watchtower/server.mjs, tested in test/tower.test.ts.

import type { Account } from './rpc.ts';
import { findAlerts } from './watch-core.ts';

export interface Registration {
  account: string;
  /** where to send alerts: ntfy.sh topic links or any https webhook that takes a POST */
  notify: string[];
}

/** https only (a webhook on a private address is never needed), and not absurdly long. */
export function notifyOk(url: string): boolean {
  if (url.length > 300) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return !(h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.local') || h.startsWith('['));
  } catch {
    return false;
  }
}

export function checkRegistration(r: unknown): Registration | string {
  const x = r as Partial<Registration> | null;
  if (!x || typeof x.account !== 'string' || !/^lyx1[0-9a-z]{20,80}$/.test(x.account)) return 'That is not a lyx1 address.';
  if (!Array.isArray(x.notify) || x.notify.length === 0 || x.notify.length > 5) return 'Give one to five places to send alerts.';
  if (!x.notify.every((u) => typeof u === 'string' && notifyOk(u))) return 'Alerts must go to https addresses.';
  return { account: x.account, notify: x.notify };
}

export interface TowerDeps {
  getAccount: (address: string) => Promise<Account | null>;
  send: (url: string, title: string, text: string) => Promise<void>;
  /** keys already told; kept by the caller between ticks */
  told: Set<string>;
  short?: (a: string) => string;
}

/** One pass over every registration. Returns how many messages went out. */
export async function tick(regs: Iterable<Registration>, d: TowerDeps): Promise<number> {
  let sent = 0;
  for (const r of regs) {
    let acct: Account | null = null;
    try {
      acct = await d.getAccount(r.account);
    } catch {
      continue; // the node did not answer: try again next time, nothing is marked as told
    }
    if (!acct) continue;
    const alerts = findAlerts([acct], { has: () => false }, d.short).filter((a) => !d.told.has(`${r.account}|${a.key}`));
    for (const a of alerts) {
      const results = await Promise.allSettled(r.notify.map((u) => d.send(u, 'LOKYX vault', `${a.text}. Open your wallet to cancel it.`)));
      if (results.some((x) => x.status === 'fulfilled')) {
        d.told.add(`${r.account}|${a.key}`);
        sent++;
      }
    }
  }
  return sent;
}

// ---------- the phone's side: several towers, so one being down does not matter ----------

export type TowerResult = { tower: string; ok: boolean; error?: string };

/** Register one account with every tower. Resolves with who accepted; never throws. */
export async function registerWithTowers(towers: string[], r: Registration, post: (url: string, body: unknown) => Promise<{ ok: boolean; status: number }>): Promise<TowerResult[]> {
  return Promise.all(
    towers.map(async (t) => {
      try {
        const res = await post(`${t.replace(/\/+$/, '')}/watch`, r);
        return res.ok ? { tower: t, ok: true } : { tower: t, ok: false, error: `It answered ${res.status}` };
      } catch {
        return { tower: t, ok: false, error: 'Could not be reached' };
      }
    }),
  );
}

/** Protected means at least two towers agreed; one is better than none but is a single point of failure. */
export const protectedBy = (rs: TowerResult[]) => rs.filter((x) => x.ok).length;

/** An ntfy link to a private, hard-to-guess topic. The topic is the only secret, so it is long and random. */
export const ntfyLink = (topic: string, host = 'https://ntfy.sh') => `${host}/${topic}`;
export const newTopic = (rand: (n: number) => Uint8Array) => 'lokyx-' + [...rand(16)].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
