// Daily spending limit: pure rules, so they can be tested without a phone.

export type Spent = { day: string; amount: string };

export const dayOf = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** How much has already been sent today (smallest units). */
export function spentToday(s: Spent | undefined, now: number): bigint {
  return s && s.day === dayOf(now) && /^\d+$/.test(s.amount) ? BigInt(s.amount) : 0n;
}

/** True when this payment would take today's total past the limit. An empty or zero limit means no limit. */
export function overLimit(limit: bigint | null, already: bigint, value: bigint): boolean {
  return limit !== null && limit > 0n && already + value > limit;
}

export function addSpent(s: Spent | undefined, now: number, value: bigint): Spent {
  return { day: dayOf(now), amount: (spentToday(s, now) + value).toString() };
}
