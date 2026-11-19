// The backup check: now and then, ask for 3 of the 24 words so you know the paper still works.

export const CHECK_EVERY_DAYS = 30;

/** Three different word positions, in order. `rand` returns 0 to 1. */
export function pickChecks(n: number, rand: () => number = Math.random): number[] {
  const s = new Set<number>();
  while (s.size < 3) s.add(Math.floor(rand() * n));
  return [...s].sort((a, b) => a - b);
}

/** Four choices, one of them right, shuffled. `pool` supplies wrong words. */
export function choices(right: string, words: string[], pool: readonly string[], rand: () => number = Math.random): string[] {
  const set = new Set<string>([right]);
  while (set.size < 4) set.add(rand() < 0.5 ? words[Math.floor(rand() * words.length)] : pool[Math.floor(rand() * pool.length)]);
  return [...set].sort(() => rand() - 0.5);
}

/** Time to ask again: never checked, or the last pass is older than the interval. */
export function checkDue(lastOk: number | undefined, now: number, days = CHECK_EVERY_DAYS): boolean {
  return !lastOk || now - lastOk > days * 86_400_000;
}
