// How full the sun is at each stage of a payment (pure, tested in test/sunfill.test.ts).

export type FillStage = 'signing' | 'sending' | 'waiting' | 'done' | 'failed';

/** How many of `n` rays are lit when a stage is reached. Waiting stops short of full; only 'done' fills it all. */
export function fillTarget(stage: FillStage, n: number): number {
  const f = stage === 'signing' ? 0.2 : stage === 'sending' ? 0.55 : stage === 'waiting' ? 0.92 : stage === 'done' ? 1 : 0;
  return Math.floor(n * f);
}

export const STAGE_TEXT: Record<FillStage, string> = {
  signing: 'Signing',
  sending: 'Sending',
  waiting: 'Waiting for a block',
  done: 'Confirmed',
  failed: 'Refused',
};
