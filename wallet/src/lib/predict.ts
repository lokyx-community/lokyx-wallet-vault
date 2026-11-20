// Prediction markets on the phone: reads the market contract, builds the calls, signs them with the key from your words
// (the same path every other contract call uses), and turns what happened into numbers for the screens.
// The rules and maths live in predict-core.ts; the contract's address and interface live in predict-abi.ts.

import { decodeEventLog, decodeFunctionResult, encodeFunctionData, encodeEventTopics, type Hex } from 'viem';
import { ensurePrimary, ethPass, ethRead, sendEthCall } from './multichain';
import {
  DEPLOYMENTS, PLAY_TOKEN_ABI, PREDICT_ABI, type Deployment, type PredictNet,
} from './predict-abi';
import {
  parseBook, type BookOrder, type MarketState, type Outcome, type Resolution, type Side, type Trade,
} from './predict-core';

export const NET: PredictNet = 'bnb-testnet';
export const deployment = (n: PredictNet = NET): Deployment => DEPLOYMENTS[n];

const STATES: MarketState[] = ['open', 'yes', 'no', 'invalid'];

async function call<T>(d: Deployment, functionName: string, args: unknown[] = []): Promise<T> {
  const data = encodeFunctionData({ abi: PREDICT_ABI, functionName, args } as never);
  const out = await ethRead(NET, d.market, data);
  return decodeFunctionResult({ abi: PREDICT_ABI, functionName, data: out } as never) as T;
}

export interface Market {
  id: number;
  title: string;
  creator: string;
  close: number;
  unit: bigint;
  state: MarketState;
  supply: bigint;
  pool: bigint;
  panel: string[];
  res: Resolution;
  bond: bigint;
}

export async function marketCount(n: PredictNet = NET): Promise<number> {
  return Number(await call<bigint>(deployment(n), 'count'));
}

export async function readMarket(id: number, n: PredictNet = NET): Promise<Market> {
  const d = deployment(n);
  const [i, r] = await Promise.all([
    call<readonly [string, string, bigint, bigint, number, bigint, bigint, readonly string[], readonly number[]]>(d, 'info', [BigInt(id)]),
    call<readonly [number, string, bigint, string, bigint, bigint, bigint]>(d, 'resolution', [BigInt(id)]),
  ]);
  const proposed = Number(r[0]);
  return {
    id,
    title: i[0],
    creator: i[1],
    close: Number(i[2]),
    unit: i[3],
    state: STATES[Number(i[4])] ?? 'open',
    supply: i[5],
    pool: i[6],
    panel: [...i[7]],
    res: { proposed: proposed === 255 ? null : proposed, proposedAt: Number(r[2]), disputedAt: Number(r[4]), disputed: r[3] !== '0x0000000000000000000000000000000000000000' },
    bond: r[5],
  };
}

/** The newest markets first, up to `limit`. */
export async function listMarkets(limit = 30, n: PredictNet = NET): Promise<Market[]> {
  const c = await marketCount(n);
  const ids = Array.from({ length: Math.min(limit, c) }, (_, k) => c - 1 - k);
  return Promise.all(ids.map((id) => readMarket(id, n)));
}

export async function readBook(id: number, n: PredictNet = NET): Promise<BookOrder[]> {
  const r = await call<readonly [readonly bigint[], readonly string[], readonly number[], readonly number[], readonly number[], readonly bigint[]]>(deployment(n), 'book', [BigInt(id)]);
  return parseBook({ ids: [...r[0]], owners: [...r[1]], outcomes: r[2].map(Number), sides: r[3].map(Number), prices: r[4].map(Number), qtys: [...r[5]] });
}

/** Free coins inside the market, and the shares held in one market. */
export async function myFree(who: string, n: PredictNet = NET): Promise<bigint> {
  return call<bigint>(deployment(n), 'free', [who]);
}
export async function myShares(id: number, who: string, n: PredictNet = NET): Promise<{ yes: bigint; no: bigint }> {
  const d = deployment(n);
  const [yes, no] = await Promise.all([call<bigint>(d, 'yesOf', [BigInt(id), who]), call<bigint>(d, 'noOf', [BigInt(id), who])]);
  return { yes, no };
}

/** The dollar token in your wallet and how much of it the market may spend for you. */
export async function walletToken(who: string, n: PredictNet = NET): Promise<{ balance: bigint; allowance: bigint }> {
  const d = deployment(n);
  const read = async (functionName: string, args: unknown[]) =>
    decodeFunctionResult({ abi: PLAY_TOKEN_ABI, functionName, data: await ethRead(NET, d.token, encodeFunctionData({ abi: PLAY_TOKEN_ABI, functionName, args } as never)) } as never) as bigint;
  const [balance, allowance] = await Promise.all([read('balanceOf', [who]), read('allowance', [who, d.market])]);
  return { balance, allowance };
}

// ---------- history for the charts ----------

const blockTimes = new Map<string, number>();
async function blockTime(hexBlock: string): Promise<number> {
  const hit = blockTimes.get(hexBlock);
  if (hit !== undefined) return hit;
  const b = (await ethPass(NET, 'eth_getBlockByNumber', [hexBlock, false])) as { timestamp: string } | null;
  const t = b ? Number(BigInt(b.timestamp)) : 0;
  blockTimes.set(hexBlock, t);
  return t;
}

export interface TradeRow extends Trade {
  taker: string;
  maker: string;
  fee: bigint;
  tx: string;
}

/** The newest block number, to start a short look-back from. */
export const headBlock = async (): Promise<bigint> => BigInt((await ethPass(NET, 'eth_blockNumber', [])) as string);

/** Every trade in one market, oldest first. Reads logs in windows so a public node never refuses the range. */
export async function readTrades(id: number, fromBlock?: bigint, n: PredictNet = NET): Promise<TradeRow[]> {
  const d = deployment(n);
  const topics = encodeEventTopics({ abi: PREDICT_ABI, eventName: 'Traded', args: { id: BigInt(id) } } as never);
  const head = BigInt((await ethPass(NET, 'eth_blockNumber', [])) as string);
  let from = fromBlock ?? d.fromBlock;
  if (from === 0n) from = head > 200_000n ? head - 200_000n : 0n; // never scan the whole chain on a phone
  const WINDOW = 4_000n;
  const rows: TradeRow[] = [];
  for (let start = from; start <= head; start += WINDOW) {
    const end = start + WINDOW - 1n > head ? head : start + WINDOW - 1n;
    const logs = (await ethPass(NET, 'eth_getLogs', [{ address: d.market, topics, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }])) as {
      data: Hex; topics: Hex[]; blockNumber: string; transactionHash: string;
    }[];
    for (const l of logs) {
      const ev = decodeEventLog({ abi: PREDICT_ABI, data: l.data, topics: l.topics as [Hex, ...Hex[]] } as never) as unknown as {
        args: { price: number; qty: bigint; taker: string; maker: string; fee: bigint };
      };
      rows.push({ at: await blockTime(l.blockNumber), yesPrice: Number(ev.args.price), qty: BigInt(ev.args.qty), taker: ev.args.taker, maker: ev.args.maker, fee: ev.args.fee, tx: l.transactionHash });
    }
  }
  return rows.sort((a, b) => a.at - b.at);
}

// ---------- doing things ----------

const send = (to: string, abi: typeof PREDICT_ABI | typeof PLAY_TOKEN_ABI, functionName: string, args: unknown[]) =>
  sendEthCall(to, encodeFunctionData({ abi, functionName, args } as never), 0n, NET);

/** Play money for trying it out. Only exists on the test network. */
export async function mintPlayMoney(amount: bigint): Promise<string> {
  const d = deployment();
  if (!d.playToken) throw new Error('There is no play money on this network.');
  const me = (await ensurePrimary()).eth;
  return send(d.token, PLAY_TOKEN_ABI, 'mint', [me, amount]);
}
export const allowMarket = (amount: bigint) => send(deployment().token, PLAY_TOKEN_ABI, 'approve', [deployment().market, amount]);
export const depositCoins = (amount: bigint) => send(deployment().market, PREDICT_ABI, 'deposit', [amount]);
export const withdrawCoins = (amount: bigint) => send(deployment().market, PREDICT_ABI, 'withdraw', [amount]);
export const placeOrder = (id: number, outcome: Outcome, side: Side, price: number, qty: bigint) =>
  send(deployment().market, PREDICT_ABI, 'place', [BigInt(id), outcome === 'yes' ? 0 : 1, side === 'buy' ? 0 : 1, price, qty]);
export const cancelOrder = (id: number, orderId: bigint) => send(deployment().market, PREDICT_ABI, 'cancel', [BigInt(id), orderId]);
/** answer: 0 Yes, 1 No, 2 Invalid */
export const proposeAnswer = (id: number, answer: 0 | 1 | 2) => send(deployment().market, PREDICT_ABI, 'propose', [BigInt(id), answer]);
export const disputeAnswer = (id: number) => send(deployment().market, PREDICT_ABI, 'dispute', [BigInt(id)]);
export const finalizeAnswer = (id: number) => send(deployment().market, PREDICT_ABI, 'finalize', [BigInt(id)]);
/** Starts a market: the question, when trading stops (unix seconds), what one winning share pays, and 3 to 9 people who settle a dispute. */
export const createMarket = (title: string, close: number, unit: bigint, panel: string[]) => send(deployment().market, PREDICT_ABI, 'create', [title, BigInt(close), unit, panel]);
/** After a market has gone 30 days past its time with no settled answer, anyone can end it and everyone gets their coins back. */
export const expireMarket = (id: number) => send(deployment().market, PREDICT_ABI, 'expire', [BigInt(id)]);
/** The address that trades here: the first account's, which is also the one the play money goes to. */
export const myAddress = async (): Promise<string> => (await ensurePrimary()).eth;
export const claimWinnings = (id: number) => send(deployment().market, PREDICT_ABI, 'claim', [BigInt(id)]);

// ---------- what happened, for the receipt ----------

export interface Result {
  /** true once the network has put it in a block */
  mined: boolean;
  ok: boolean;
  block: number | null;
  /** the matches this order caused (empty when it only rested in the book) */
  fills: { yesPrice: number; qty: bigint; fee: bigint }[];
}

/** Looks the transaction up; call again until `mined`. Reads only the fills where `who` was the one who placed the order. */
export async function receiptOf(hash: string, who: string): Promise<Result> {
  const r = (await ethPass(NET, 'eth_getTransactionReceipt', [hash])) as null | {
    status: string; blockNumber: string; logs: { address: string; data: Hex; topics: Hex[] }[];
  };
  if (!r) return { mined: false, ok: false, block: null, fills: [] };
  const d = deployment();
  const fills: Result['fills'] = [];
  for (const l of r.logs) {
    if (l.address.toLowerCase() !== d.market.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: PREDICT_ABI, data: l.data, topics: l.topics as [Hex, ...Hex[]] } as never) as unknown as {
        eventName: string; args: { price: number; qty: bigint; taker: string; fee: bigint };
      };
      if (ev.eventName === 'Traded' && ev.args.taker.toLowerCase() === who.toLowerCase()) {
        fills.push({ yesPrice: Number(ev.args.price), qty: BigInt(ev.args.qty), fee: ev.args.fee });
      }
    } catch {
      // not one of ours
    }
  }
  return { mined: true, ok: r.status === '0x1', block: Number(BigInt(r.blockNumber)), fills };
}

/** Waits for a transaction, polling gently. Resolves with its outcome, or `mined: false` if it takes longer than `ms`. */
export async function waitFor(hash: string, who: string, ms = 90_000): Promise<Result> {
  const end = Date.now() + ms;
  for (;;) {
    const o = await receiptOf(hash, who);
    if (o.mined || Date.now() > end) return o;
    await new Promise((r) => setTimeout(r, 2_500));
  }
}
