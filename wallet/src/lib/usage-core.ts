// Anonymous, opt-in usage counts: designed, OFF, and not wired to send anything.
//
// What it would count: that a wallet is installed, that it was opened this week, and roughly how much is
// protected by vaults (in coarse buckets). What it would never include: addresses, keys, balances, node
// URLs, IP-derived data, device ids. Nothing is collected until the person turns it on AND a release
// switches FEATURES.usageCounts on AND an endpoint is configured. `buildReport` is the whole payload.

export interface UsageSettings {
  /** The person's choice. Off by default. */
  optIn: boolean;
}
export const DEFAULT_USAGE: UsageSettings = { optIn: false };

export interface UsageReport {
  /** A random id made on the phone, rotated monthly. Not derived from any key or device. */
  rid: string;
  /** ISO year-week, e.g. 2026-W46 */
  week: string;
  appVersion: string;
  platform: 'ios' | 'android';
  /** vaults on this phone's accounts, as a count */
  vaults: number;
  /** total LYX held in those vaults, as a coarse bucket */
  valueProtected: '0' | '<100' | '<10k' | '<1M' | '>=1M';
}

export function bucketValue(lyx: number): UsageReport['valueProtected'] {
  if (lyx <= 0) return '0';
  if (lyx < 100) return '<100';
  if (lyx < 10_000) return '<10k';
  if (lyx < 1_000_000) return '<1M';
  return '>=1M';
}

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

export function buildReport(i: { rid: string; now: Date; appVersion: string; platform: 'ios' | 'android'; vaults: number; vaultLyx: number }): UsageReport {
  return { rid: i.rid, week: isoWeek(i.now), appVersion: i.appVersion, platform: i.platform, vaults: i.vaults, valueProtected: bucketValue(i.vaultLyx) };
}

/** True only when everything required is on. The default in this build is false three times over. */
export function mayReport(p: { flag: boolean; settings: UsageSettings; endpoint: string | null }): boolean {
  return p.flag && p.settings.optIn && !!p.endpoint;
}

/** Sends a report if (and only if) `mayReport`. `post` is injected so tests can prove nothing leaves. */
export async function maybeSend(p: { flag: boolean; settings: UsageSettings; endpoint: string | null; report: () => UsageReport; post: (url: string, body: string) => Promise<void> }): Promise<boolean> {
  if (!mayReport(p)) return false;
  await p.post(p.endpoint!, JSON.stringify(p.report()));
  return true;
}
