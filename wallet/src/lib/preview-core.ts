// What a request would move, read from a test run on the node (nothing is signed or sent). Pure, so it is tested
// (test/preview.test.ts). Two node answers are understood: eth_simulateV1 with traceTransfers, and debug_traceCall with
// the call tracer and logs. Anything else, or any shape it does not recognise, is "unavailable", never a guess.

import type { Tone } from './sign-view-core.ts';

export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
export const BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
/** eth_simulateV1 with traceTransfers reports plain coin transfers as Transfer logs from this address. */
export const NATIVE_ADDR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export interface Log {
  address: string;
  topics: string[];
  data: string;
}

/** One asset: the chain's own coin, a token, or one numbered item (an NFT / a 1155 id). */
export interface Move {
  /** 'native' or a contract address (lower case) */
  token: string;
  /** set for a numbered item */
  id?: bigint;
  /** a 721 item (amount is 1) */
  nft?: boolean;
  amount: bigint;
}

export type Run = { ok: true; logs: Log[]; reverted: boolean; reason?: string } | { ok: false };

const lc = (s: string) => s.toLowerCase();
const word = (hex: string, i: number) => hex.slice(2 + 64 * i, 2 + 64 * (i + 1));
const topicAddr = (t: string | undefined) => (t && /^0x[0-9a-fA-F]{64}$/.test(t) ? `0x${t.slice(26)}`.toLowerCase() : null);
const isLog = (l: unknown): l is Log => !!l && typeof l === 'object' && typeof (l as Log).address === 'string' && Array.isArray((l as Log).topics) && typeof (l as Log).data === 'string';

/** eth_simulateV1 answer: [{ calls: [{ status, logs, error }] }]. We send one call, so read the first. */
export function parseSimulate(res: unknown): Run {
  const block = Array.isArray(res) ? res[0] : null;
  const call = block && Array.isArray(block.calls) ? block.calls[0] : null;
  if (!call || typeof call !== 'object') return { ok: false };
  const failed = call.status === '0x0' || call.status === 0 || !!call.error;
  const logs = Array.isArray(call.logs) ? (call.logs as unknown[]).filter(isLog) : [];
  return { ok: true, logs: failed ? [] : logs, reverted: failed, reason: typeof call.error?.message === 'string' ? call.error.message : undefined };
}

interface Frame {
  type?: string;
  from?: string;
  to?: string;
  value?: string;
  error?: string;
  calls?: Frame[];
  logs?: Log[];
}

/** debug_traceCall with callTracer { withLog: true }. Coin moves come from the value on each real call. */
export function parseTrace(res: unknown): Run {
  if (!res || typeof res !== 'object' || typeof (res as Frame).from !== 'string') return { ok: false };
  const top = res as Frame;
  if (top.error) return { ok: true, logs: [], reverted: true, reason: top.error };
  const logs: Log[] = [];
  const walk = (f: Frame) => {
    const kind = (f.type ?? 'CALL').toUpperCase();
    if (/^(CALL|CREATE|CREATE2)$/.test(kind) && f.value && /^0x[0-9a-fA-F]+$/.test(f.value) && BigInt(f.value) > 0n && f.from && f.to) {
      logs.push({ address: NATIVE_ADDR, topics: [TRANSFER, `0x${'0'.repeat(24)}${f.from.slice(2)}`, `0x${'0'.repeat(24)}${f.to.slice(2)}`], data: `0x${BigInt(f.value).toString(16).padStart(64, '0')}` });
    }
    if (!f.error) for (const l of f.logs ?? []) if (isLog(l)) logs.push(l);
    for (const c of f.calls ?? []) if (!c.error) walk(c);
  };
  walk(top);
  return { ok: true, logs, reverted: false };
}

const add = (m: Map<string, Move>, mv: Move) => {
  const k = `${mv.token}:${mv.id ?? ''}`;
  const have = m.get(k);
  if (have) have.amount += mv.amount;
  else m.set(k, { ...mv });
};

/** What leaves and what arrives for one account, from the logs of a run. */
export function effects(logs: Log[], me: string): { out: Move[]; in: Move[] } {
  const you = lc(me);
  const out = new Map<string, Move>();
  const inn = new Map<string, Move>();
  const book = (from: string | null, to: string | null, mv: Move) => {
    if (from === you && to !== you) add(out, mv);
    else if (to === you && from !== you) add(inn, mv);
  };
  for (const l of logs) {
    const t = l.topics;
    const addr = lc(l.address);
    if (!t.length) continue;
    const t0 = lc(t[0]);
    if (t0 === TRANSFER) {
      if (t.length === 3 && /^0x[0-9a-fA-F]{64}$/.test(l.data)) {
        book(topicAddr(t[1]), topicAddr(t[2]), { token: addr === NATIVE_ADDR ? 'native' : addr, amount: BigInt(l.data) });
      } else if (t.length === 4) {
        book(topicAddr(t[1]), topicAddr(t[2]), { token: addr, id: BigInt(t[3]), nft: true, amount: 1n });
      }
    } else if (t0 === SINGLE && t.length === 4 && l.data.length >= 2 + 128) {
      book(topicAddr(t[2]), topicAddr(t[3]), { token: addr, id: BigInt(`0x${word(l.data, 0)}`), amount: BigInt(`0x${word(l.data, 1)}`) });
    } else if (t0 === BATCH && t.length === 4) {
      // data = offset(ids), offset(values), then each array as length + items
      const offIds = Number(BigInt(`0x${word(l.data, 0)}`)) / 32;
      const offVals = Number(BigInt(`0x${word(l.data, 1)}`)) / 32;
      if (!Number.isInteger(offIds) || !Number.isInteger(offVals)) continue;
      const n = Number(BigInt(`0x${word(l.data, offIds)}`));
      if (!(n >= 0 && n <= 200) || l.data.length < 2 + 64 * (Math.max(offIds, offVals) + 1 + n)) continue;
      for (let i = 0; i < n; i++) {
        book(topicAddr(t[2]), topicAddr(t[3]), { token: addr, id: BigInt(`0x${word(l.data, offIds + 1 + i)}`), amount: BigInt(`0x${word(l.data, offVals + 1 + i)}`) });
      }
    }
  }
  return { out: [...out.values()].filter((m) => m.amount > 0n), in: [...inn.values()].filter((m) => m.amount > 0n) };
}

/** Plain transfers: leaving with nothing back is exactly what they are for. */
const TRANSFER_SELECTORS = ['0xa9059cbb', '0x23b872dd', '0x42842e0e', '0xb88d4fde', '0xf242432a', '0x2eb2c2d6'];
export const isPlainTransfer = (data: string) => TRANSFER_SELECTORS.includes(lc(data.slice(0, 10)));

export type Preview =
  | { state: 'ready'; out: Move[]; in: Move[]; reverted: boolean; reason?: string }
  | { state: 'unavailable' };

export function toPreview(run: Run, me: string): Preview {
  if (!run.ok) return { state: 'unavailable' };
  if (run.reverted) return { state: 'ready', out: [], in: [], reverted: true, reason: run.reason };
  const e = effects(run.logs, me);
  return { state: 'ready', out: e.out, in: e.in, reverted: false };
}

/**
 * The colour a preview asks for, or null when it has nothing to add. It only ever raises caution:
 *  - the request would fail on its own: review.
 *  - three or more different assets leave and nothing comes back, or an item and a token leave and nothing comes back: stop.
 *  - something beyond the coins the site declared leaves and nothing comes back, outside a plain transfer: review.
 *  - the declared coins leave and nothing at all comes back (a contract call): review.
 * A good preview never lowers what the other checks said; "unavailable" adds nothing.
 */
export function previewTone(p: Preview, call: { value: bigint; data: string }): Tone | null {
  if (p.state !== 'ready') return null;
  if (p.reverted) return 'review';
  const plain = call.data === '0x' || call.data === '' || isPlainTransfer(call.data);
  if (plain) return null;
  if (p.in.length) return null;
  const extra = p.out.filter((m) => !(m.token === 'native' && m.amount <= call.value));
  const nfts = extra.filter((m) => m.nft || m.id !== undefined).length;
  if (extra.length >= 3 || (nfts > 0 && extra.length - nfts > 0)) return 'stop';
  if (extra.length > 0) return 'review';
  if (call.value > 0n && p.out.some((m) => m.token === 'native')) return 'review';
  return null;
}

/** The plain words for a preview that raised the colour. */
export function previewWords(tone: Tone, p: Preview, unit: string): { headline: string; says: string } | null {
  if (p.state !== 'ready') return null;
  if (p.reverted) return { headline: 'This would fail', says: 'The network says this would not go through. You would only lose the network fee.' };
  const n = p.out.length;
  if (tone === 'stop') return { headline: 'This takes more than it shows', says: `The test run shows ${n} things leaving your wallet and nothing coming back.` };
  if (tone === 'review') return { headline: p.in.length ? 'Check what leaves' : 'Coins leave and nothing arrives', says: `The test run shows ${n === 1 ? 'one thing' : `${n} things`} leaving${p.in.length ? '' : ` (${unit} or tokens) and nothing coming back`}. That can be fine, so check the app first.` };
  return null;
}
