// The signing sheet's decisions, pure so they are tested (test/sign-view.test.ts): which of three colours a request gets,
// and how an approval is rewritten to a smaller amount. The screen only draws what this says.

import type { Level as AssessLevel } from './signing-core.ts';
import type { Level as CheckLevel } from './contract-check-core.ts';

export type Tone = 'allow' | 'review' | 'stop';

const RANK: Record<Tone, number> = { allow: 0, review: 1, stop: 2 };
const fromAssess = (l: AssessLevel): Tone => l;
const fromCheck = (l: CheckLevel): Tone => (l === 'danger' ? 'stop' : l === 'caution' ? 'review' : 'allow');

/** One colour from the two checks: the worse of them. A check that has not finished counts as nothing yet. */
export function combineTone(assess: AssessLevel | null, check: CheckLevel | null): Tone {
  const a = assess ? fromAssess(assess) : 'allow';
  const c = check ? fromCheck(check) : 'allow';
  return RANK[a] >= RANK[c] ? a : c;
}

const APPROVE = '0x095ea7b3';

/** An ERC-20 approve(spender, amount) with the amount replaced. Anything else comes back unchanged (null): only that one
 *  shape is rewritten, because it is the one whose meaning is certain. */
export function capApproval(data: string, amount: bigint): string | null {
  const m = /^(0x095ea7b3)([0-9a-fA-F]{64})([0-9a-fA-F]{64})$/.exec(data);
  if (!m || amount < 0n || amount >= 1n << 256n) return null;
  return `${APPROVE}${m[2]}${amount.toString(16).padStart(64, '0')}`;
}

/** The amount a person typed, in a token's units, as a number of base units. Null when it is not a plain amount. */
export function typedAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) return null;
  return BigInt(w + f.padEnd(decimals, '0'));
}
