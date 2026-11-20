// A failure, said as a person would say it, with the next steps offered as choices. Pure rules, no phone APIs.
// It builds on plain-error.ts (which turns a technical message into a sentence) and adds what to offer next.

import { plainError } from './plain-error.ts';

export type OptionId = 'retry' | 'wait' | 'faucet' | 'copy-address' | 'copy-details' | 'check-again' | 'close';

export interface ProblemOption {
  id: OptionId;
  label: string;
  /** the one to do first; shown as the filled button */
  main?: boolean;
}

export interface Problem {
  /** what kind of trouble it is, for the icon and for tests */
  kind: 'offline' | 'busy' | 'funds' | 'pending' | 'refused' | 'needs-check' | 'other';
  title: string;
  body: string;
  options: ProblemOption[];
  /** the technical text, kept for "Copy details" so support can see what really happened */
  details: string;
}

export interface Context {
  /** "Base Sepolia", "BNB Chain testnet": the network the person was using */
  where?: string;
  /** the coin that pays the fee there: "ETH", "BNB" */
  symbol?: string;
}

/** Faucets for play coins, by network name as shown to the person. Only networks where we know a real one. */
export const FAUCETS: Record<string, string> = { 'BNB Chain testnet': 'https://www.bnbchain.org/en/testnet-faucet' };
export const faucetFor = (where?: string): string | null => (where ? FAUCETS[where] ?? null : null);

const raw = (e: unknown): string =>
  String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as { message?: string })?.message ?? e ?? '').trim();

const close: ProblemOption = { id: 'close', label: 'Not now' };
const details = (r: string): ProblemOption => ({ id: 'copy-details', label: 'Copy the details' });

/** The sheet's content for a failure, or null when nothing should be shown (the person cancelled on purpose). */
export function problemFrom(e: unknown, ctx: Context = {}): Problem | null {
  const text = raw(e);
  const where = ctx.where ?? 'the network';
  const symbol = ctx.symbol ?? 'coins';
  if (/user (rejected|denied|cancel)|cancell?ed/i.test(text)) return null;

  if (/UnknownHost|Unable to resolve host|Network request failed|network error|fetch failed|Failed to fetch|ECONN|ENOTFOUND|ETIMEDOUT|timed? ?out|Software caused connection abort|Could not connect|offline/i.test(text))
    return { kind: 'offline', title: 'No connection', body: `Can't reach ${where} right now. Check your internet, then try again.`, options: [{ id: 'retry', label: 'Try again', main: true }, close], details: text };

  if (/answered (429|503|502|504)|rate.?limit|too many requests/i.test(text))
    return { kind: 'busy', title: `${where.replace(/^./, (c) => c.toUpperCase())} is busy`, body: 'Too many people are asking at once. Nothing was lost. Give it a moment.', options: [{ id: 'retry', label: 'Try again', main: true }, close], details: text };

  if (/insufficient funds/i.test(text) || /has no test .* on /i.test(text)) {
    const opts: ProblemOption[] = [{ id: 'retry', label: 'I added some, try again', main: true }, { id: 'copy-address', label: 'Copy my address' }];
    if (faucetFor(ctx.where)) opts.splice(1, 0, { id: 'faucet', label: `Get free test ${symbol}` });
    opts.push(close);
    return { kind: 'funds', title: `Not enough ${symbol} for the fee`, body: `Your everyday address needs a little ${symbol} on ${where} to pay the one-time network fee. Test coins are free.`, options: opts, details: text };
  }

  if (/nonce too low|replacement transaction underpriced|already known/i.test(text))
    return { kind: 'pending', title: 'One moment', body: 'The network is still finishing your last step. Wait about a minute, then try again.', options: [{ id: 'retry', label: 'Try again', main: true }, close], details: text };

  if (/does not look right|created but/i.test(text))
    return { kind: 'needs-check', title: 'Your vault needs a second look', body: 'It was created, but a check afterwards did not pass. Do not put money in it yet. Check again in a moment; the network may simply be a step behind.', options: [{ id: 'check-again', label: 'Check again', main: true }, details(text), close], details: text };

  if (/^(execution reverted|reverted)/i.test(text) || /network turned it down/i.test(text))
    return { kind: 'refused', title: 'The network said no', body: `${plainError(e, where).replace(/^The network turned it down:?\s*/i, '').replace(/^./, (c) => c.toUpperCase()) || 'It refused this step.'} Nothing was spent beyond the network fee.`.replace(/\.\.$/, '.'), options: [{ id: 'retry', label: 'Try again', main: true }, details(text), close], details: text };

  const plain = plainError(e, where);
  return { kind: 'other', title: "That didn't work", body: plain.length > 240 ? `${plain.slice(0, 237)}…` : plain, options: [{ id: 'retry', label: 'Try again', main: true }, details(text), close], details: text };
}

/** For a sentence that is already in plain words: the title and tone of the pop-up card that carries it. */
export function cardFor(sentence: string): { title: string; tone: 'wait' | 'bad'; generic: boolean } {
  const p = problemFrom(sentence);
  if (!p || p.kind === 'other') return { title: "That didn't work", tone: 'bad', generic: true };
  return { title: p.title, tone: p.kind === 'refused' ? 'bad' : 'wait', generic: false };
}
