// LI.FI quotes, and the checks a quote has to pass before the wallet will let it be signed. Pure and tested.
//
// LI.FI is a swap and bridge aggregator: we ask it for a route, it returns the exact transaction to send. The
// wallet never trusts that transaction. Everything the quote says is compared with what the person asked for, and
// anything that does not match stops the swap. The wallet adds its own fee through LI.FI's `fee` parameter; that
// fee is 0 until a release turns it on (see config below), and it is always shown before the slide.
//
// What this was written against: LI.FI's published API reference (GET /v1/quote, GET /v1/status). It has NOT been
// run against the live service: the machine this was written on cannot reach li.quest. The first thing to do on a
// machine that can is `node scripts/lifi-probe.mjs` (see test/lifi.test.ts for the shapes it is expected to match).

export const LIFI_BASE = 'https://li.quest';
export const NATIVE = '0x0000000000000000000000000000000000000000';
/** LI.FI's id for Solana. Solana routes are refused until the wallet can read a Solana transaction. */
export const SOLANA_ID = 1151111081099710;

export interface LifiConfig {
  /** the name the wallet is registered under in the LI.FI Partner Portal */
  integrator: string;
  /** the fee the wallet adds, in basis points of the amount sent. 0 = none (this build) */
  feeBps: number;
  /** a quote asking for more than this is refused, whatever else is true */
  maxFeeBps: number;
  /** slippage as a fraction: 0.005 = 0.5% */
  slippage: number;
  /**
   * The only contracts a quote may send to or ask approval for, per chain id, lowercase. Empty = every quote is
   * refused: the addresses are pinned from LI.FI's own list (GET /v1/chains) and checked against a block explorer
   * before the first release that turns swaps on. Nothing here is a guess.
   */
  routers: Record<number, string[]>;
  /** most the quoted fees (all of them, ours included) may add up to, as a fraction of the amount */
  maxTotalFee: number;
  /** the quoted value in USD may be this much below the value sent before the swap stops (fraction) */
  maxLoss: number;
}

export const LIFI: LifiConfig = { integrator: '', feeBps: 0, maxFeeBps: 100, slippage: 0.005, routers: {}, maxTotalFee: 0.03, maxLoss: 0.02 };

export interface QuoteRequest {
  fromChain: number;
  toChain: number;
  /** a contract address, or NATIVE. Never a symbol: a symbol is how a fake token gets in. */
  fromToken: string;
  toToken: string;
  fromAddress: string;
  /** where the coins arrive. Defaults to fromAddress: your own address. */
  toAddress?: string;
  fromAmount: bigint;
  order?: 'FASTEST' | 'CHEAPEST';
}

const isAddr = (s: unknown): s is string => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function buildQuoteUrl(r: QuoteRequest, cfg: LifiConfig = LIFI): string {
  if (!isAddr(r.fromToken) || !isAddr(r.toToken)) throw new Error('Coins must be given by contract address');
  if (!isAddr(r.fromAddress) || (r.toAddress !== undefined && !isAddr(r.toAddress))) throw new Error('Not a valid address');
  if (r.fromAmount <= 0n) throw new Error('Enter an amount');
  if (cfg.feeBps < 0 || cfg.feeBps > cfg.maxFeeBps) throw new Error('Fee is outside what this wallet allows');
  const q = new URLSearchParams({
    fromChain: String(r.fromChain),
    toChain: String(r.toChain),
    fromToken: r.fromToken,
    toToken: r.toToken,
    fromAddress: r.fromAddress,
    toAddress: r.toAddress ?? r.fromAddress,
    fromAmount: r.fromAmount.toString(),
    slippage: String(cfg.slippage),
    order: r.order ?? 'CHEAPEST',
  });
  if (cfg.integrator) q.set('integrator', cfg.integrator);
  if (cfg.feeBps > 0) q.set('fee', String(cfg.feeBps / 10000));
  return `${LIFI_BASE}/v1/quote?${q.toString()}`;
}

export interface FeeCost { name: string; percentage: number; amountUSD: number; included: boolean; native: boolean; amount: bigint }
export interface ParsedQuote {
  tool: string;
  toolName: string;
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAddress: string;
  toAddress: string;
  fromAmount: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  fromAmountUSD: number | null;
  toAmountUSD: number | null;
  approvalAddress: string | null;
  seconds: number;
  fees: FeeCost[];
  tx: { to: string; data: string; value: bigint; chainId: number };
}

const big = (v: unknown): bigint | null => {
  try {
    return typeof v === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(v) ? BigInt(v) : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  } catch {
    return null;
  }
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Turns LI.FI's answer into what the wallet needs, or says what is missing. A missing piece is a refusal, never a default. */
export function parseQuote(json: unknown): { ok: true; q: ParsedQuote } | { ok: false; why: string } {
  const j = rec(json);
  const action = rec(j?.action);
  const est = rec(j?.estimate);
  const tx = rec(j?.transactionRequest);
  if (!j || !action || !est) return { ok: false, why: 'The swap service sent an answer this wallet cannot read' };
  if (!tx) return { ok: false, why: 'The quote has no transaction to sign' };
  const tokenOf = (t: unknown) => (rec(t)?.address as string | undefined) ?? '';
  const fromAmount = big(action.fromAmount);
  const toAmount = big(est.toAmount);
  const toAmountMin = big(est.toAmountMin);
  const value = tx.value === undefined ? 0n : big(tx.value);
  const fromChain = num(action.fromChainId);
  const toChain = num(action.toChainId);
  const chainId = num(tx.chainId);
  const fromToken = tokenOf(action.fromToken);
  const toToken = tokenOf(action.toToken);
  if (fromAmount === null || toAmount === null || toAmountMin === null || value === null || fromChain === null || toChain === null || chainId === null) return { ok: false, why: 'The quote is missing an amount or a chain' };
  if (!isAddr(fromToken) || !isAddr(toToken) || !isAddr(action.fromAddress) || !isAddr(action.toAddress)) return { ok: false, why: 'The quote is missing a coin or an address' };
  if (!isAddr(tx.to) || typeof tx.data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(tx.data)) return { ok: false, why: 'The quote has no usable transaction' };
  const fees: FeeCost[] = (Array.isArray(est.feeCosts) ? est.feeCosts : []).flatMap((f) => {
    const r = rec(f);
    const amount = big(r?.amount);
    if (!r || amount === null) return [];
    return [{ name: String(r.name ?? 'fee'), percentage: num(r.percentage) ?? 0, amountUSD: num(r.amountUSD) ?? 0, included: r.included !== false, native: isAddr(tokenOf(r.token)) && same(tokenOf(r.token), NATIVE), amount }];
  });
  return {
    ok: true,
    q: {
      tool: String(j.tool ?? ''),
      toolName: String(rec(j.toolDetails)?.name ?? j.tool ?? ''),
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAddress: action.fromAddress as string,
      toAddress: action.toAddress as string,
      fromAmount,
      toAmount,
      toAmountMin,
      fromAmountUSD: num(est.fromAmountUSD),
      toAmountUSD: num(est.toAmountUSD),
      approvalAddress: isAddr(est.approvalAddress) ? est.approvalAddress : null,
      seconds: num(est.executionDuration) ?? 0,
      fees,
      tx: { to: tx.to, data: tx.data, value, chainId },
    },
  };
}

export type Level = 'pass' | 'warn' | 'stop';
export interface Check { id: string; level: Level; text: string }
export interface Verdict {
  checks: Check[];
  /** stop = the swap cannot be signed; warn = only after the person ticks "I read this"; pass = go */
  level: Level;
}

/**
 * Every check the review screen shows. The quote came from a server and may be wrong or hostile, so each line
 * compares it with what the person asked for. `req` is what the person asked for, not what the quote says.
 */
export function checkQuote(q: ParsedQuote, req: QuoteRequest, cfg: LifiConfig = LIFI): Verdict {
  const c: Check[] = [];
  const add = (id: string, ok: boolean, good: string, bad: string, level: Level = 'stop') => c.push({ id, level: ok ? 'pass' : level, text: ok ? good : bad });
  const to = req.toAddress ?? req.fromAddress;
  const native = same(req.fromToken, NATIVE);

  if (req.fromChain === SOLANA_ID || req.toChain === SOLANA_ID) add('chain', false, '', 'Solana routes cannot be read by this wallet yet, so they are not allowed');
  add('route', q.fromChain === req.fromChain && q.toChain === req.toChain, 'The route runs between the chains you picked', 'The quote is for different chains than you picked');
  add('coins', same(q.fromToken, req.fromToken) && same(q.toToken, req.toToken), 'Both coins are matched by contract address', 'The quote swaps different coins than you picked');
  add('amount', q.fromAmount === req.fromAmount, `Sends exactly the amount you entered`, 'The quote sends a different amount than you entered');
  add('sender', same(q.fromAddress, req.fromAddress), 'Sent from your address', 'The quote is for a different sending address');
  add('receiver', same(q.toAddress, to), 'Arrives at your own address', 'The quote sends the result to a different address');

  const allowed = cfg.routers[q.tx.chainId] ?? [];
  add('chain-id', q.tx.chainId === req.fromChain, 'The transaction is for the chain you are paying from', 'The transaction is for a different chain');
  add('router', allowed.some((a) => same(a, q.tx.to)), 'The swap contract is on the list this wallet pins', allowed.length ? 'The transaction goes to a contract that is not on the list this wallet accepts' : 'No swap contract is pinned for this chain yet, so swaps are off');
  if (!native) {
    add('approval', q.approvalAddress !== null && allowed.some((a) => same(a, q.approvalAddress!)), 'Approval would go to the same pinned contract, for this amount only', 'The approval would go to a contract that is not pinned');
  }
  const extra = q.fees.filter((f) => !f.included && f.native).reduce((s, f) => s + f.amount, 0n);
  add('value', native ? q.tx.value <= q.fromAmount + extra && q.tx.value >= q.fromAmount : q.tx.value <= extra, 'Only the amount shown leaves your account', 'The transaction would send more than the amount shown');

  add('min', q.toAmountMin > 0n && q.toAmountMin <= q.toAmount, 'A minimum you receive is set', 'The quote has no safe minimum');
  const slip = q.toAmount > 0n ? Number(q.toAmount - q.toAmountMin) / Number(q.toAmount) : 1;
  add('slippage', slip <= cfg.slippage * 2 + 1e-9, 'The minimum is within your slippage', 'The minimum is much lower than the quote', 'stop');

  if (cfg.feeBps > cfg.maxFeeBps) add('fee', false, '', 'The fee is above what this wallet allows');
  const total = q.fees.reduce((s, f) => s + f.percentage, 0);
  add('fees', total <= cfg.maxTotalFee, 'Fees are within the usual range', `Fees add up to ${(total * 100).toFixed(1)}%, which is unusually high`);

  if (q.fromAmountUSD !== null && q.toAmountUSD !== null && q.fromAmountUSD > 0) {
    const worse = 1 - q.toAmountUSD / q.fromAmountUSD;
    c.push({ id: 'price', level: worse > cfg.maxLoss ? 'stop' : 'pass', text: worse > cfg.maxLoss ? `You would get ${(worse * 100).toFixed(1)}% less value than you send, over the ${(cfg.maxLoss * 100).toFixed(0)}% limit` : `About ${Math.max(0, worse * 100).toFixed(1)}% worse than the market price` });
  } else {
    c.push({ id: 'price', level: 'warn', text: 'No market price was sent, so the price could not be compared' });
  }

  const level: Level = c.some((x) => x.level === 'stop') ? 'stop' : c.some((x) => x.level === 'warn') ? 'warn' : 'pass';
  return { checks: c, level };
}

/** The approval the wallet builds itself: the exact amount, to the pinned contract, never "unlimited". */
export function approvalFor(q: ParsedQuote): { token: string; spender: string; amount: bigint } | null {
  if (same(q.fromToken, NATIVE) || !q.approvalAddress) return null;
  return { token: q.fromToken, spender: q.approvalAddress, amount: q.fromAmount };
}

/** What to show for the fee line: what the wallet asked for, from the amount sent, as a fraction and in USD. */
export function ourFee(q: ParsedQuote, cfg: LifiConfig = LIFI): { bps: number; usd: number | null } {
  return { bps: cfg.feeBps, usd: q.fromAmountUSD === null ? null : (q.fromAmountUSD * cfg.feeBps) / 10000 };
}

export type SwapState = 'not-found' | 'pending' | 'done' | 'partial' | 'refunded' | 'failed';
export function statusUrl(txHash: string, fromChain: number, toChain: number): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Not a transaction hash');
  return `${LIFI_BASE}/v1/status?txHash=${txHash}&fromChain=${fromChain}&toChain=${toChain}`;
}
/** Reads LI.FI's status. A status it does not recognise is "pending", never "done". */
export function parseStatus(json: unknown): SwapState {
  const j = rec(json);
  const s = j?.status;
  const sub = j?.substatus;
  if (s === 'NOT_FOUND') return 'not-found';
  if (s === 'FAILED') return 'failed';
  if (s === 'DONE') return sub === 'COMPLETED' ? 'done' : sub === 'PARTIAL' ? 'partial' : sub === 'REFUNDED' ? 'refunded' : 'pending';
  return 'pending';
}
