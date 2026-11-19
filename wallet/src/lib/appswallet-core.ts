// The Apps wallet: a second Ethereum-style key made from the same 24 words. Websites only ever see this one, so a
// drained site can take what is in here and nothing else. Pure rules, no phone APIs.

/** The key's place among the wallet's Ethereum keys (0 is the main address, which the vaults and shared accounts use). */
export const APPS_INDEX = 1;

export interface RefillPlan {
  /** goes out straight away, inside today's allowance */
  instant: boolean;
  /** how long it waits when it is not instant, in seconds */
  waitSecs: number;
  /** when the money arrives, in ms (now when instant) */
  arrivesAt: number;
}

/** A top-up from a vault: inside today's allowance there is no wait; above it, the vault's normal wait applies. */
export function refillPlan(amount: bigint, left: bigint, cooldownSecs: number, now: number): RefillPlan {
  const instant = amount <= left;
  const waitSecs = instant ? 0 : Math.max(0, cooldownSecs);
  return { instant, waitSecs, arrivesAt: now + waitSecs * 1000 };
}

/** "Arrives tomorrow 4:05 PM" / "Arrives today 4:05 PM" in the person's time. */
export function arrivalText(arrivesAt: number, now: number): string {
  const d = new Date(arrivesAt);
  const n = new Date(now);
  const day = d.toDateString() === n.toDateString() ? 'today' : new Date(now + 86400_000).toDateString() === d.toDateString() ? 'tomorrow' : d.toLocaleDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Arrives ${day} ${time}`;
}

/** Which key a website's address belongs to: 1 for the Apps wallet, 0 for the main address. */
export function accountIndexFor(address: string, apps: string | null | undefined): number {
  return apps && address.toLowerCase() === apps.toLowerCase() ? APPS_INDEX : 0;
}
