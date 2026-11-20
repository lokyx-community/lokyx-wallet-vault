import { PopCard } from './PopCard';
import type { OptionId, Problem } from '../lib/problem-core';

/**
 * A problem as a card that pops up in the middle of the screen: what happened in one sentence, what it means for the
 * person's money, and the next steps as buttons. Replaces the line of red text.
 */
export function ProblemSheet({ problem, onPick, onClose }: { problem: Problem | null; onPick: (id: OptionId) => void; onClose: () => void }) {
  return (
    <PopCard
      open={!!problem}
      tone={problem && (problem.kind === 'refused' || problem.kind === 'other') ? 'bad' : 'wait'}
      title={problem?.title ?? ''}
      body={problem?.body ?? ''}
      options={(problem?.options ?? []).map((o) => ({ label: o.label, main: o.main, onPress: () => (o.id === 'close' ? onClose() : onPick(o.id)) }))}
      onClose={onClose}
    />
  );
}
