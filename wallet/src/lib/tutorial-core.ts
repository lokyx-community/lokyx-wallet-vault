// Short animated tutorials shown the first time someone opens a complex feature. Pure: what each one says, and the
// "seen once" rules. The screen that plays them is ui/Tutorial.tsx; the storage is tutorial.ts.

export type TutorialId = 'vault' | 'recovery' | 'apps' | 'swap' | 'predict';

/** One step: a line under the picture. The picture itself belongs to the feature (ui/TutorialScenes.tsx) and changes with the step. */
export type TutorialStep = { line: string };
export type Tutorial = { id: TutorialId; title: string; steps: TutorialStep[] };

// Rule for every line: one or two short plain sentences, no jargon, says what happens to the person's money.
export const TUTORIALS: Record<TutorialId, Tutorial> = {
  vault: {
    id: 'vault',
    title: 'How your vault works',
    steps: [
      { line: 'A daily allowance leaves at once, so everyday spending works as normal.' },
      { line: 'Anything bigger waits first and can only go to your safe address. You can cancel it while it waits.' },
      { line: 'Even someone who gets into your phone is held to the same limit and the same wait.' },
    ],
  },
  recovery: {
    id: 'recovery',
    title: 'How the recovery key works',
    steps: [
      { line: 'Your 12 recovery words are kept apart from your phone. They never leave it once typed here.' },
      { line: 'With them you can cancel anything that is still waiting.' },
      { line: 'Or move everything to your safe address. They can do nothing else.' },
    ],
  },
  apps: {
    id: 'apps',
    title: 'How the Apps wallet works',
    steps: [
      { line: 'Websites connect to this small wallet, never to your main one.' },
      { line: 'Add only what you want to use. Anything else stays out of reach of sites.' },
      { line: 'You approve every action on your phone before a site can spend.' },
    ],
  },
  swap: {
    id: 'swap',
    title: 'How a swap works',
    steps: [
      { line: 'You offer one coin and ask for another. Someone takes the other side.' },
      { line: 'Both sides are locked until the trade completes, or you get your coin back.' },
      { line: 'You see the final amounts before you confirm.' },
    ],
  },
  predict: {
    id: 'predict',
    title: 'How prediction markets work',
    steps: [
      { line: 'Each question has a Yes price and a No price. The price is the crowd’s chance, in cents.' },
      { line: 'Buy at 60¢ and if you are right it pays 100¢. If you are wrong it pays nothing.' },
      { line: 'After the end time an answer is proposed. Anyone can dispute it before it is final.' },
    ],
  },
};

export const SEEN_KEY = 'tutorials-seen';

/** Read the saved list. Anything unreadable counts as "nothing seen yet". Unknown ids are dropped. */
export function parseSeen(raw: string | null): TutorialId[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is TutorialId => typeof x === 'string' && x in TUTORIALS);
  } catch {
    return [];
  }
}

export const hasSeen = (seen: TutorialId[], id: TutorialId) => seen.includes(id);

/** The new list after one is seen. Never adds twice. */
export const withSeen = (seen: TutorialId[], id: TutorialId): TutorialId[] => (seen.includes(id) ? seen : [...seen, id]);

export const serializeSeen = (seen: TutorialId[]) => JSON.stringify(seen);

/** Position in a tutorial after pressing Next: the last step ends it. */
export const nextStep = (i: number, n: number): { i: number; done: boolean } => (i + 1 >= n ? { i, done: true } : { i: i + 1, done: false });
