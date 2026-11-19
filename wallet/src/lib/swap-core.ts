// Copied from the website (app/src/lib/swap.ts): the same offer and acceptance codes, so a phone can swap
// with a browser. Pure rules only; storage and chain access are in swaps.ts.
// LYX <-> BTC / ETH atomic swaps. No server and no custody: two people swap codes, then each
// side's app watches both chains and tells its owner what to do next.
//
// Whoever starts the swap (the initiator) holds the secret and locks first, with the longer
// timeout. The other side locks second with a shorter timeout, so they always get their refund
// window before the initiator's ends.
//
//   sell-lyx: initiator locks LYX -> responder locks BTC/ETH -> initiator claims it (reveals the
//             secret) -> responder claims the LYX with it
//   buy-lyx:  initiator locks BTC/ETH -> responder locks LYX -> initiator claims the LYX (reveals
//             the secret) -> responder claims the BTC/ETH with it
//
// The rules below only see a summary of the other chain (a Leg), so bitcoin and ethereum follow
// exactly the same logic.

import { base64urlnopad } from '@scure/base';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import * as btc from './swap-btc.ts';
import * as eth from './swap-eth.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { addressFromPrivateKey, isAddress } from './lokyx.ts';

export type Direction = 'sell-lyx' | 'buy-lyx';
export type Asset = 'btc' | 'eth';
export type Role = 'initiator' | 'responder';

export interface Offer {
  v: 1;
  chainId: number;
  dir: Direction;
  /** What LYX is traded against. Missing means bitcoin (offers from before ETH existed). */
  asset?: Asset;
  /** LYX amount in base units. */
  lyx: string;
  hashlock: string;
  salt: string;
  initLyx: string;
  /** How long the LYX lock lasts, in LOKYX blocks. */
  lyxBlocks: number;
  created: number;
  // bitcoin
  btcNet?: btc.BtcNet;
  sats?: number;
  initBtcPub?: string;
  btcBlocks?: number;
  /** buy-lyx only: the BTC refund height, fixed when the offer is made. */
  btcLocktime?: number;
  // ethereum (or another EVM chain)
  eth?: { chainId: number; contract: string; wei: string; hours: number };
  initEth?: string;
  /** buy-lyx only: when the ETH lock becomes refundable (unix seconds). */
  ethRefundTime?: number;
}

export interface Accept {
  v: 1;
  salt: string;
  respLyx: string;
  respBtcPub?: string;
  /** sell-lyx only: BTC refund height, fixed by the responder (who funds BTC). */
  btcLocktime?: number;
  respEth?: string;
  /** sell-lyx only: when the ETH lock becomes refundable (unix seconds). */
  ethRefundTime?: number;
}

export const assetOf = (o: Offer): Asset => o.asset ?? 'btc';

export interface SwapRecord {
  offer: Offer;
  accept?: Accept;
  role: Role;
  /** Set once known. */
  lyxLockId?: string;
  btcClaimTx?: string;
  btcRefundTx?: string;
  lyxCloseTx?: string;
  ethTx?: string;
  /** EVM block to start looking for this swap's events from. */
  ethFromBlock?: number;
  notes?: string;
  updated: number;
}

const PREFIX_OFFER = 'lokyx-swap-offer:';
const PREFIX_ACCEPT = 'lokyx-swap-accept:';

const enc = (o: unknown) => base64urlnopad.encode(utf8ToBytes(JSON.stringify(o)));
const dec = (s: string) => JSON.parse(new TextDecoder().decode(base64urlnopad.decode(s)));

export const offerCode = (o: Offer) => PREFIX_OFFER + enc(o);
export const acceptCode = (a: Accept) => PREFIX_ACCEPT + enc(a);

export function parseOffer(code: string): Offer {
  const c = code.trim();
  if (!c.startsWith(PREFIX_OFFER)) throw new Error('That isn\'t a swap offer code');
  let o: Offer;
  try {
    o = dec(c.slice(PREFIX_OFFER.length));
  } catch {
    throw new Error('The offer code is damaged. Copy it again.');
  }
  if (o.v !== 1 || !['sell-lyx', 'buy-lyx'].includes(o.dir)) throw new Error('Unknown offer version');
  if (!isAddress(o.initLyx) || !/^[0-9a-f]{64}$/.test(o.hashlock) || !(BigInt(o.lyx) > 0n)) {
    throw new Error('The offer has invalid details');
  }
  if (assetOf(o) === 'btc') {
    if (!/^0[23][0-9a-f]{64}$/.test(o.initBtcPub ?? '') || !((o.sats ?? 0) > btc.DUST)) throw new Error('The offer has invalid bitcoin details');
    if (o.dir === 'buy-lyx' && !o.btcLocktime) throw new Error('The offer is missing its bitcoin refund height');
  } else {
    if (!o.eth || !eth.isEthAddress(o.eth.contract) || !eth.isEthAddress(o.initEth ?? '') || !(BigInt(o.eth.wei) > 0n)) {
      throw new Error('The offer has invalid ethereum details');
    }
    if (o.dir === 'buy-lyx' && !o.ethRefundTime) throw new Error('The offer is missing its ethereum refund time');
  }
  return o;
}

export function parseAccept(code: string, offer: Offer): Accept {
  const c = code.trim();
  if (!c.startsWith(PREFIX_ACCEPT)) throw new Error('That isn\'t a swap acceptance code');
  let a: Accept;
  try {
    a = dec(c.slice(PREFIX_ACCEPT.length));
  } catch {
    throw new Error('The acceptance code is damaged. Copy it again.');
  }
  if (a.salt !== offer.salt) throw new Error('This acceptance is for a different offer');
  if (!isAddress(a.respLyx)) throw new Error('The acceptance has invalid details');
  if (a.respLyx === offer.initLyx) throw new Error('You can\'t swap with yourself');
  if (assetOf(offer) === 'btc') {
    if (!/^0[23][0-9a-f]{64}$/.test(a.respBtcPub ?? '')) throw new Error('The acceptance has invalid bitcoin details');
    if (offer.dir === 'sell-lyx' && !a.btcLocktime) throw new Error('The acceptance is missing its bitcoin refund height');
  } else {
    if (!eth.isEthAddress(a.respEth ?? '')) throw new Error('The acceptance has no ethereum address');
    if (a.respEth!.toLowerCase() === offer.initEth!.toLowerCase()) throw new Error('You can\'t swap with yourself');
    if (offer.dir === 'sell-lyx' && !a.ethRefundTime) throw new Error('The acceptance is missing its ethereum refund time');
  }
  return a;
}

// ---------- keys (all derived from the LOKYX key + the swap salt, nothing secret is stored) ----------

export function newSalt(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** Which BTC key this side holds: the initiator claims BTC when selling LYX, refunds it when buying. */
export function myBtcPurpose(role: Role, dir: Direction): 'claim' | 'refund' {
  const initClaims = dir === 'sell-lyx';
  return (role === 'initiator') === initClaims ? 'claim' : 'refund';
}

export function myBtcKey(lokyxKey: Uint8Array, r: SwapRecord): Uint8Array {
  return btc.swapBtcKey(lokyxKey, r.offer.salt, myBtcPurpose(r.role, r.offer.dir));
}

export function secretFor(lokyxKey: Uint8Array, r: SwapRecord): Uint8Array {
  const s = btc.swapSecret(lokyxKey, r.offer.salt);
  if (bytesToHex(btc.hashlockOf(s)) !== r.offer.hashlock) throw new Error('This wallet didn\'t create this swap');
  return s;
}

export interface OfferParams {
  chainId: number;
  dir: Direction;
  lyx: bigint;
  lyxBlocks: number;
  asset: Asset;
  // bitcoin
  btcNet?: btc.BtcNet;
  sats?: number;
  btcBlocks?: number;
  btcTip?: number;
  // ethereum
  eth?: { chainId: number; contract: string; wei: bigint; hours: number };
  myEth?: string;
  ethNow?: number;
}

export function makeOffer(lokyxKey: Uint8Array, p: OfferParams): Offer {
  const salt = newSalt();
  const secret = btc.swapSecret(lokyxKey, salt);
  const base = {
    v: 1 as const,
    chainId: p.chainId,
    dir: p.dir,
    asset: p.asset,
    lyx: p.lyx.toString(),
    hashlock: bytesToHex(btc.hashlockOf(secret)),
    salt,
    initLyx: addressFromPrivateKey(lokyxKey),
    lyxBlocks: p.lyxBlocks,
    created: Math.floor(Date.now() / 1000),
  };
  if (p.asset === 'eth') {
    return {
      ...base,
      eth: { chainId: p.eth!.chainId, contract: p.eth!.contract, wei: p.eth!.wei.toString(), hours: p.eth!.hours },
      initEth: p.myEth,
      ethRefundTime: p.dir === 'buy-lyx' ? (p.ethNow ?? 0) + p.eth!.hours * 3600 : undefined,
    };
  }
  const purpose = myBtcPurpose('initiator', p.dir);
  return {
    ...base,
    btcNet: p.btcNet,
    sats: p.sats,
    initBtcPub: bytesToHex(btc.pubOf(btc.swapBtcKey(lokyxKey, salt, purpose))),
    btcBlocks: p.btcBlocks,
    btcLocktime: p.dir === 'buy-lyx' ? (p.btcTip ?? 0) + (p.btcBlocks ?? 0) : undefined,
  };
}

/** `otherNow`: bitcoin tip height, or the EVM chain's latest block timestamp. */
export function makeAccept(lokyxKey: Uint8Array, o: Offer, otherNow: number, myEth?: string): Accept {
  const base = { v: 1 as const, salt: o.salt, respLyx: addressFromPrivateKey(lokyxKey) };
  if (assetOf(o) === 'eth') {
    return { ...base, respEth: myEth, ethRefundTime: o.dir === 'sell-lyx' ? otherNow + o.eth!.hours * 3600 : undefined };
  }
  const purpose = myBtcPurpose('responder', o.dir);
  return {
    ...base,
    respBtcPub: bytesToHex(btc.pubOf(btc.swapBtcKey(lokyxKey, o.salt, purpose))),
    btcLocktime: o.dir === 'sell-lyx' ? otherNow + o.btcBlocks! : undefined,
  };
}

/** The bitcoin contract, once both sides are known. */
export function htlcOf(r: SwapRecord): btc.Htlc | null {
  const { offer: o, accept: a } = r;
  if (!a || assetOf(o) !== 'btc') return null;
  const init = hexToBytes(o.initBtcPub!);
  const resp = hexToBytes(a.respBtcPub!);
  return {
    hashlock: hexToBytes(o.hashlock),
    claimPub: o.dir === 'sell-lyx' ? init : resp,
    refundPub: o.dir === 'sell-lyx' ? resp : init,
    locktime: (o.dir === 'sell-lyx' ? a.btcLocktime : o.btcLocktime)!,
  };
}

/** LOKYX lock: who sends and who receives. */
export function lyxParties(r: SwapRecord): { sender: string; recipient: string } | null {
  if (!r.accept) return null;
  return r.offer.dir === 'sell-lyx'
    ? { sender: r.offer.initLyx, recipient: r.accept.respLyx }
    : { sender: r.accept.respLyx, recipient: r.offer.initLyx };
}

/** The ethereum lock: who locks, who can claim, until when, how much, and its id. */
export function ethLockOf(r: SwapRecord) {
  const { offer: o, accept: a } = r;
  if (!a || assetOf(o) !== 'eth') return null;
  const sender = o.dir === 'sell-lyx' ? a.respEth! : o.initEth!;
  const recipient = o.dir === 'sell-lyx' ? o.initEth! : a.respEth!;
  const refundTime = (o.dir === 'sell-lyx' ? a.ethRefundTime : o.ethRefundTime)!;
  const amount = BigInt(o.eth!.wei);
  return { sender, recipient, refundTime, amount, id: eth.lockId(sender, recipient, o.hashlock, refundTime, amount) };
}

/** Does this side lock LYX (as opposed to the other coin)? */
export const locksLyx = (r: SwapRecord) => (r.role === 'initiator') === (r.offer.dir === 'sell-lyx');

// ---------- live state and what to do next ----------

export interface LyxSwapView {
  id: string;
  status: 'pending' | 'open' | 'claiming' | 'claimed' | 'refunding' | 'refunded';
  sender: string;
  recipient: string;
  amount: string;
  amountLyx: string;
  hashlock: string;
  refundHeight: number;
  lockHeight: number | null;
  height: number;
  blocksUntilRefund: number;
  closeTx: string | null;
  closePending: boolean;
  secret: string | null;
}

/** What the swap logic needs to know about the bitcoin or ethereum side. */
export interface Leg {
  /** Hours until the other lock becomes refundable (negative once it has). */
  hoursLeft: number;
  /** Refundable now. */
  expired: boolean;
  /** Locked, the right amount, with enough confirmations. */
  funded: boolean;
  /** Something is locked and not spent yet (any confirmations). */
  anyFunding: boolean;
  /** The claim revealed this secret. */
  claimedSecret: Uint8Array | null;
  refunded: boolean;
  /** The claim has a confirmation. */
  closeConfirmed: boolean;
  /** Amount seen so far, in the smallest unit (sats or wei). */
  received: bigint;
}

export interface Live {
  lyxHeight: number;
  lyxBlockTime: number;
  lyx?: LyxSwapView;
  leg: Leg;
  /** Raw chain data for the UI (building claim/refund transactions). */
  btc?: btc.HtlcState;
  btcAddress?: string;
  eth?: eth.EthLockState;
}

export const LYX_CONFS = 3;
export const BTC_CONFS = 1;
export const ETH_CONFS = 2;
/** How much longer the first lock must last than the second. */
export const MARGIN_HOURS = 6;

export function btcLeg(r: SwapRecord, b: btc.HtlcState): Leg {
  const h = htlcOf(r)!;
  const spent = b.spend;
  const unspent = (min: number) => b.funding.some((f) => f.confirmations >= min && !f.spent);
  const confirmedIn = b.funding.filter((f) => f.confirmations >= BTC_CONFS).reduce((s, f) => s + f.value, 0);
  return {
    hoursLeft: (h.locktime - b.tip) / 6,
    // bitcoin accepts a refund once the tip has reached the locktime (nLockTime < next block height)
    expired: b.tip >= h.locktime,
    funded: confirmedIn >= r.offer.sats! && unspent(BTC_CONFS),
    anyFunding: unspent(0),
    claimedSecret: spent?.secret ?? null,
    refunded: !!spent && !spent.secret,
    closeConfirmed: (spent?.confirmations ?? 0) >= 1,
    received: BigInt(b.received),
  };
}

export function ethLeg(r: SwapRecord, e: eth.EthLockState): Leg {
  const l = ethLockOf(r)!;
  // the lock id commits to sender, recipient, hashlock, refund time and amount, so an open lock at
  // this id is the agreed one
  const secret = e.claimed && bytesToHex(sha256(e.claimed.secret)) === r.offer.hashlock ? e.claimed.secret : null;
  return {
    hoursLeft: (l.refundTime - e.now) / 3600,
    expired: e.now >= l.refundTime,
    funded: !!e.open && e.open.amount === l.amount && e.open.confirmations >= ETH_CONFS,
    anyFunding: !!e.open,
    claimedSecret: secret,
    refunded: !!e.refunded,
    closeConfirmed: (e.claimed?.confirmations ?? 0) >= 1,
    received: e.open?.amount ?? 0n,
  };
}

export type Step =
  | { kind: 'wait-accept' }
  | { kind: 'share-accept' }
  | { kind: 'lock-lyx'; refundHeight: number }
  | { kind: 'wait-lyx-lock'; mine: boolean }
  | { kind: 'fund-other' }
  | { kind: 'wait-other-fund' }
  | { kind: 'claim-other' }
  | { kind: 'claim-lyx'; lockId: string }
  | { kind: 'wait-claim'; leg: 'other' | 'lyx' }
  | { kind: 'wait-refund'; leg: 'other' | 'lyx' }
  | { kind: 'refund-lyx'; lockId: string }
  | { kind: 'refund-other' }
  | { kind: 'confirming'; got: 'other' | 'lyx' }
  | { kind: 'done'; got: 'other' | 'lyx' }
  | { kind: 'refunded'; leg: 'other' | 'lyx' }
  | { kind: 'unsafe'; reason: string };

const gotIt = (got: 'other' | 'lyx', confirmed: boolean): Step => ({ kind: confirmed ? 'done' : 'confirming', got });
const hoursLyx = (blocks: number, live: Live) => (blocks * live.lyxBlockTime) / 3600;

/**
 * Next step for this side. A pure function of the saved record and live chain data, so a reload
 * just works out where things stand again.
 */
export function nextStep(r: SwapRecord, live: Live): Step {
  const o = r.offer;
  if (!r.accept) return r.role === 'initiator' ? { kind: 'wait-accept' } : { kind: 'share-accept' };
  const g = live.leg;
  const l = live.lyx;
  const lyxNext = live.lyxHeight + 1;
  const name = assetOf(o) === 'btc' ? 'bitcoin' : 'ethereum';

  const lyxLocked = !!l && l.lockHeight !== null && live.lyxHeight - l.lockHeight + 1 >= LYX_CONFS;
  const lyxClaimed = !!l && (l.status === 'claimed' || l.status === 'claiming');
  const lyxRefunded = !!l && (l.status === 'refunded' || l.status === 'refunding');
  const lyxExpired = !!l && lyxNext >= l.refundHeight;
  const parties = lyxParties(r)!;
  const lyxMatches = !!l && BigInt(l.amount) >= BigInt(o.lyx) && l.hashlock === o.hashlock &&
    l.recipient === parties.recipient && l.sender === parties.sender;
  const claimed = !!g.claimedSecret;

  if (o.dir === 'sell-lyx' && r.role === 'initiator') {
    // lock LYX, then claim the other coin
    if (lyxRefunded) return { kind: 'refunded', leg: 'lyx' };
    if (claimed) return gotIt('other', g.closeConfirmed);
    if (!l) {
      if (g.hoursLeft <= 1) return { kind: 'unsafe', reason: `The ${name} refund time in the acceptance has passed or is too close. Start a new swap.` };
      if (hoursLyx(o.lyxBlocks, live) < g.hoursLeft + MARGIN_HOURS) {
        return { kind: 'unsafe', reason: `The ${name} lock in this acceptance lasts too long next to your LYX lock. Ask for a fresh acceptance code.` };
      }
      return { kind: 'lock-lyx', refundHeight: lyxNext + o.lyxBlocks };
    }
    if (l.status === 'open' && lyxExpired) return { kind: 'refund-lyx', lockId: l.id };
    if (l.lockHeight === null) return { kind: 'wait-lyx-lock', mine: true };
    if (g.funded) return { kind: 'claim-other' };
    if (g.refunded) return { kind: 'wait-refund', leg: 'lyx' };
    return { kind: 'wait-other-fund' };
  }

  if (o.dir === 'sell-lyx' && r.role === 'responder') {
    // lock the other coin, then claim LYX with the secret the initiator reveals
    if (lyxClaimed) return gotIt('lyx', l!.status === 'claimed');
    if (g.refunded) return { kind: 'refunded', leg: 'other' };
    if (claimed && l && l.status === 'open') return { kind: 'claim-lyx', lockId: l.id };
    if (g.anyFunding && g.expired && !claimed) return { kind: 'refund-other' };
    if (!l || !lyxLocked) return { kind: 'wait-lyx-lock', mine: false };
    if (!lyxMatches) return { kind: 'unsafe', reason: `The LYX lock doesn't match the offer (amount, secret or addresses). Don't send ${name}.` };
    if (lyxRefunded || l.status !== 'open') {
      return g.anyFunding ? { kind: 'wait-refund', leg: 'other' } : { kind: 'refunded', leg: 'lyx' };
    }
    if (!g.funded && !g.anyFunding) {
      const lyxLeft = hoursLyx(l.refundHeight - live.lyxHeight, live);
      if (g.hoursLeft <= 1) return { kind: 'unsafe', reason: `Too little time left on the ${name} side. Don't send anything.` };
      if (lyxLeft < g.hoursLeft + MARGIN_HOURS) return { kind: 'unsafe', reason: `The LYX lock runs out too soon to be safe. Don't send ${name}.` };
      return { kind: 'fund-other' };
    }
    if (!g.funded) return { kind: 'wait-other-fund' };
    return { kind: 'wait-claim', leg: 'other' };
  }

  if (o.dir === 'buy-lyx' && r.role === 'initiator') {
    // lock the other coin, then claim LYX (which reveals the secret)
    if (claimed) return { kind: 'done', got: 'lyx' };
    if (lyxClaimed) return gotIt('lyx', l!.status === 'claimed');
    if (g.refunded) return { kind: 'refunded', leg: 'other' };
    if (g.anyFunding && g.expired) return { kind: 'refund-other' };
    if (!g.funded) {
      if (g.anyFunding) return { kind: 'wait-other-fund' };
      if (g.hoursLeft < hoursLyx(o.lyxBlocks, live) + MARGIN_HOURS) {
        return { kind: 'unsafe', reason: `This offer is too old: its ${name} refund time is too close. Make a new one.` };
      }
      return { kind: 'fund-other' };
    }
    if (!l || !lyxLocked) return { kind: 'wait-lyx-lock', mine: false };
    if (!lyxMatches) return { kind: 'unsafe', reason: `The LYX lock doesn't match the offer. Don't claim it; wait for your ${name} refund.` };
    if (l.status === 'open' && !lyxExpired) return { kind: 'claim-lyx', lockId: l.id };
    return { kind: 'wait-refund', leg: 'other' };
  }

  // buy-lyx responder: wait for the other coin, lock LYX, claim the other coin once the secret shows up
  if (claimed) return gotIt('other', g.closeConfirmed);
  if (lyxRefunded) return { kind: 'refunded', leg: 'lyx' };
  if (lyxClaimed && g.anyFunding) return { kind: 'claim-other' };
  if (l && l.status === 'open' && lyxExpired) return { kind: 'refund-lyx', lockId: l.id };
  if (g.refunded) return l ? { kind: 'wait-refund', leg: 'lyx' } : { kind: 'refunded', leg: 'other' };
  if (!g.funded) return { kind: 'wait-other-fund' };
  if (!l) {
    if (g.hoursLeft < hoursLyx(o.lyxBlocks, live) + MARGIN_HOURS) {
      return { kind: 'unsafe', reason: `The ${name} lock runs out too soon to safely lock your LYX.` };
    }
    return { kind: 'lock-lyx', refundHeight: lyxNext + o.lyxBlocks };
  }
  if (l.lockHeight === null) return { kind: 'wait-lyx-lock', mine: true };
  return { kind: 'wait-claim', leg: 'lyx' };
}

/** The secret, wherever it has shown up: my own derivation, the bitcoin claim, or the LOKYX claim. */
export function knownSecret(r: SwapRecord, live: Live, lokyxKey?: Uint8Array): Uint8Array | null {
  if (r.role === 'initiator' && lokyxKey) return secretFor(lokyxKey, r);
  if (live.leg.claimedSecret) return live.leg.claimedSecret;
  if (live.lyx?.secret) return hexToBytes(live.lyx.secret);
  return null;
}

export type Speed = 'fast' | 'standard';
/** Refund times. Only matter if someone stops halfway; a normal swap takes minutes. */
export const LOCK_HOURS: Record<Speed, { first: number; second: number }> = {
  fast: { first: 12, second: 4 },
  standard: { first: 48, second: 24 },
};

export function defaultBlocks(dir: Direction, lyxBlockTime: number, speed: Speed = 'standard') {
  const h = LOCK_HOURS[speed];
  const lyxHours = dir === 'sell-lyx' ? h.first : h.second;
  const otherHours = dir === 'sell-lyx' ? h.second : h.first;
  return { lyxBlocks: Math.round((lyxHours * 3600) / lyxBlockTime), btcBlocks: otherHours * 6, otherHours };
}
