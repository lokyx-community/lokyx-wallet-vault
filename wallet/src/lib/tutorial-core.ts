// Short animated tutorials shown the first time someone opens a complex feature. Pure: what each one says, and the
// "seen once" rules. The screen that plays them is ui/Tutorial.tsx; the storage is tutorial.ts.

export type TutorialId = 'vault' | 'recovery' | 'apps' | 'swap' | 'predict';

/** The pictures a step can play. Each one loops quietly while its line is on screen. */
export type SceneKind = 'split' | 'wait' | 'approve' | 'drop' | 'swap' | 'price';

export type TutorialStep = { scene: SceneKind; line: string };
export type Tutorial = { id: TutorialId; title: string; steps: TutorialStep[] };

// Rule for every line: one or two short plain sentences, no jargon, says what happens to the person's money.
export const TUTORIALS: Record<TutorialId, Tutorial> = {
  vault: {
    id: 'vault',
    title: 'How your vault works',
    steps: [
      { scene: 'drop', line: 'A daily allowance leaves at once, so everyday spending works as normal.' },
      { scene: 'wait', line: 'Anything bigger waits first and can only go to your safe address. You can cancel it while it waits.' },
      { scene: 'approve', line: 'Even someone who gets into your phone is held to the same limit and the same wait.' },
    ],
  },
  recovery: {
    id: 'recovery',
    title: 'How the recovery key works',
    steps: [
      { scene: 'split', line: 'Your 12 recovery words are kept apart from your phone. They never leave it once typed here.' },
      { scene: 'wait', line: 'With them you can cancel anything that is still waiting.' },
      { scene: 'approve', line: 'Or move everything to your safe address. They can do nothing else.' },
    ],
  },
  apps: {
    id: 'apps',
    title: 'How the Apps wallet works',
    steps: [
      { scene: 'drop', line: 'Websites connect to this small wallet, never to your main one.' },
      { scene: 'drop', line: 'Add only what you want to use. Anything else stays out of reach of sites.' },
      { scene: 'approve', line: 'You approve every action on your phone before a site can spend.' },
    ],
  },
  swap: {
    id: 'swap',
    title: 'How a swap works',
    steps: [
      { scene: 'swap', line: 'You offer one coin and ask for another. Someone takes the other side.' },
      { scene: 'wait', line: 'Both sides are locked until the trade completes, or you get your coin back.' },
      { scene: 'approve', line: 'You see the final amounts before you confirm.' },
    ],
  },
  predict: {
    id: 'predict',
    title: 'How prediction markets work',
    steps: [
      { scene: 'price', line: 'Each question has a Yes price and a No price. The price is the crowd’s chance, in cents.' },
      { scene: 'drop', line: 'Buy at 60¢ and if you are right it pays 100¢. If you are wrong it pays nothing.' },
      { scene: 'wait', line: 'After the end time an answer is proposed. Anyone can dispute it before it is final.' },
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
