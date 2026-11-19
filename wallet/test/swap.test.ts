import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// the website's tests, run unchanged: a tiny expect() for the matchers they use
function matches(a: any, b: any): boolean {
  if (b && typeof b === 'object' && !(b instanceof Uint8Array)) return !!a && Object.keys(b).every((k) => matches(a[k], b[k]));
  return Object.is(a, b) || (typeof a === 'bigint' && a === b);
}
const plain = (v: any) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? `${x}n` : x)));
function expect(a: any) {
  return {
    toBe: (b: any) => assert.ok(Object.is(a, b), `expected ${String(a)} to be ${String(b)}`),
    not: { toBe: (b: any) => assert.ok(!Object.is(a, b), `expected ${String(a)} not to be ${String(b)}`) },
    toBeGreaterThan: (b: any) => assert.ok(a > b),
    toBeNull: () => assert.equal(a, null),
    toEqual: (b: any) => assert.deepEqual(plain(a), plain(b)), // like vitest: undefined fields don't count
    toMatchObject: (b: any) => assert.ok(matches(a, b), `expected ${JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? String(v) : v))} to match ${JSON.stringify(b)}`),
    toThrow: (re?: RegExp | string) => assert.throws(a, re instanceof RegExp ? re : re ? new RegExp(re) : undefined),
  };
}
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as sw from '../src/lib/swap-core.ts';
import * as btc from '../src/lib/swap-btc.ts';
import * as eth from '../src/lib/swap-eth.ts';
import { addressFromPrivateKey } from '../src/lib/lokyx.ts';

// A tiny fake world: one LOKYX swap lock and one bitcoin HTLC, moved forward by the test.
const ALICE = hexToBytes('11'.repeat(32));
const BOB = hexToBytes('22'.repeat(32));
const MALLORY = hexToBytes('33'.repeat(32));
const BLOCK = 60; // LOKYX block time
const LYX = 5n * 10n ** 18n;
const SATS = 100_000;

interface World {
  lyxHeight: number;
  btcTip: number;
  lock?: sw.LyxSwapView;
  funding: (btc.Utxo & { height: number | null; spent: boolean })[];
  spend?: { txid: string; secret: Uint8Array | null; height: number | null };
}

function live(w: World, r: sw.SwapRecord): sw.Live {
  const h = sw.htlcOf(r);
  const conf = (ht: number | null) => (ht === null ? 0 : w.btcTip - ht + 1);
  const b: btc.HtlcState = {
    tip: w.btcTip,
    funding: w.funding.map((f) => ({ txid: f.txid, vout: f.vout, value: f.value, confirmations: conf(f.height), spent: f.spent })),
    received: w.funding.reduce((s, f) => s + f.value, 0),
    spend: w.spend && { txid: w.spend.txid, secret: w.spend.secret, confirmations: conf(w.spend.height) },
  };
  return {
    lyxHeight: w.lyxHeight,
    lyxBlockTime: BLOCK,
    lyx: w.lock ? { ...w.lock, height: w.lyxHeight } : undefined,
    btcAddress: h ? btc.htlcAddress(h, 'regtest') : undefined,
    btc: h ? b : undefined,
    leg: sw.btcLeg(r, b),
  };
}

function start(dir: sw.Direction, btcTip = 1000, speed: sw.Speed = 'standard') {
  const blocks = sw.defaultBlocks(dir, BLOCK, speed);
  const offer = sw.makeOffer(ALICE, { chainId: 77702, asset: 'btc', btcNet: 'regtest', dir, lyx: LYX, sats: SATS, ...blocks, btcTip });
  const alice: sw.SwapRecord = { offer, role: 'initiator', updated: 0 };
  const accept = sw.makeAccept(BOB, offer, btcTip);
  const bob: sw.SwapRecord = { offer, accept, role: 'responder', updated: 0 };
  alice.accept = sw.parseAccept(sw.acceptCode(accept), sw.parseOffer(sw.offerCode(offer)));
  const w: World = { lyxHeight: 500, btcTip, funding: [] };
  return { alice, bob, w };
}

const step = (r: sw.SwapRecord, w: World) => sw.nextStep(r, live(w, r));

function lockLyx(w: World, r: sw.SwapRecord, refundHeight: number, over: Partial<sw.LyxSwapView> = {}) {
  const p = sw.lyxParties(r)!;
  w.lock = {
    id: 'ab'.repeat(32), status: 'pending', sender: p.sender, recipient: p.recipient, amount: r.offer.lyx,
    amountLyx: '5', hashlock: r.offer.hashlock, refundHeight, lockHeight: null, height: w.lyxHeight,
    blocksUntilRefund: 0, closeTx: null, closePending: false, secret: null, ...over,
  };
}
const mineLyx = (w: World, n = 1) => {
  w.lyxHeight += n;
  if (w.lock && w.lock.lockHeight === null) w.lock.lockHeight = w.lyxHeight - n + 1;
};
const mineBtc = (w: World, n = 1) => {
  w.btcTip += n;
  for (const f of w.funding) if (f.height === null) f.height = w.btcTip - n + 1;
  if (w.spend && w.spend.height === null) w.spend.height = w.btcTip - n + 1;
};
const fund = (w: World, value = SATS) => w.funding.push({ txid: 'cd'.repeat(32), vout: 0, value, height: null, spent: false });

describe('codes', () => {
  it('round-trip and reject tampering', () => {
    const { alice, bob } = start('sell-lyx');
    expect(sw.parseOffer(sw.offerCode(alice.offer))).toEqual(alice.offer);
    const other = sw.makeOffer(ALICE, { chainId: 77702, asset: 'btc', btcNet: 'regtest', dir: 'sell-lyx', lyx: LYX, sats: SATS, lyxBlocks: 10, btcBlocks: 10 });
    expect(() => sw.parseAccept(sw.acceptCode(bob.accept!), other)).toThrow(/different offer/);
    expect(() => sw.parseOffer('lokyx-swap-offer:!!!')).toThrow();
    expect(() => sw.parseOffer('hello')).toThrow(/isn't a swap offer/);
  });
  it('only the creator can derive the secret, and both sides agree on the bitcoin contract', () => {
    const { alice, bob } = start('sell-lyx');
    expect(bytesToHex(btc.hashlockOf(sw.secretFor(ALICE, alice)))).toBe(alice.offer.hashlock);
    expect(() => sw.secretFor(BOB, alice)).toThrow();
    expect(btc.htlcAddress(sw.htlcOf(alice)!, 'regtest')).toBe(btc.htlcAddress(sw.htlcOf(bob)!, 'regtest'));
    // each side holds the right key for its path
    const h = sw.htlcOf(alice)!;
    expect(bytesToHex(btc.pubOf(sw.myBtcKey(ALICE, alice)))).toBe(bytesToHex(h.claimPub));
    expect(bytesToHex(btc.pubOf(sw.myBtcKey(BOB, bob)))).toBe(bytesToHex(h.refundPub));
  });
});

describe('sell LYX for BTC', () => {
  it('happy path', () => {
    const { alice, bob, w } = start('sell-lyx');
    const s = step(alice, w);
    expect(s.kind).toBe('lock-lyx');
    expect(step(bob, w).kind).toBe('wait-lyx-lock');
    lockLyx(w, alice, (s as { refundHeight: number }).refundHeight);
    expect(step(alice, w)).toMatchObject({ kind: 'wait-lyx-lock', mine: true });
    mineLyx(w, 1);
    expect(step(bob, w).kind).toBe('wait-lyx-lock'); // not enough confirmations yet
    mineLyx(w, 2);
    w.lock!.status = 'open';
    expect(step(bob, w).kind).toBe('fund-other');
    expect(step(alice, w).kind).toBe('wait-other-fund');
    fund(w);
    expect(step(alice, w).kind).toBe('wait-other-fund'); // unconfirmed
    mineBtc(w);
    expect(step(alice, w).kind).toBe('claim-other');
    expect(step(bob, w).kind).toBe('wait-claim');
    // Alice claims bitcoin, revealing the secret
    const secret = sw.knownSecret(alice, live(w, alice), ALICE)!;
    w.funding[0].spent = true;
    w.spend = { txid: 'ef'.repeat(32), secret, height: null };
    expect(step(alice, w)).toMatchObject({ kind: 'confirming', got: 'other' });
    mineBtc(w);
    expect(step(alice, w)).toMatchObject({ kind: 'done', got: 'other' });
    expect(step(bob, w)).toMatchObject({ kind: 'claim-lyx' });
    expect(bytesToHex(sw.knownSecret(bob, live(w, bob))!)).toBe(bytesToHex(secret));
    w.lock!.status = 'claiming';
    expect(step(bob, w)).toMatchObject({ kind: 'confirming', got: 'lyx' });
    w.lock!.status = 'claimed';
    expect(step(bob, w)).toMatchObject({ kind: 'done', got: 'lyx' });
  });

  it('Bob never pays: Alice gets her LYX back after the lock', () => {
    const { alice, bob, w } = start('sell-lyx');
    const rh = (step(alice, w) as { refundHeight: number }).refundHeight;
    lockLyx(w, alice, rh);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    w.lyxHeight = rh - 2;
    expect(step(alice, w).kind).toBe('wait-other-fund');
    w.lyxHeight = rh - 1; // next block is the refund height
    expect(step(alice, w).kind).toBe('refund-lyx');
    // and Bob must not fund this late
    expect(step(bob, w).kind).not.toBe('fund-other');
  });

  it('Alice disappears after Bob pays: both refund, Bob first', () => {
    const { alice, bob, w } = start('sell-lyx');
    lockLyx(w, alice, (step(alice, w) as { refundHeight: number }).refundHeight);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    fund(w);
    mineBtc(w);
    const lt = sw.htlcOf(bob)!.locktime;
    w.btcTip = lt - 1;
    expect(step(bob, w).kind).toBe('wait-claim');
    w.btcTip = lt;
    expect(step(bob, w).kind).toBe('refund-other');
    // Bob's bitcoin refund comes long before Alice's LYX refund
    const lyxRefundHours = ((w.lock!.refundHeight - w.lyxHeight) * BLOCK) / 3600;
    expect(lyxRefundHours).toBeGreaterThan(sw.MARGIN_HOURS);
  });

  it('Bob refuses to pay into a lock that does not match', () => {
    for (const bad of [
      { amount: (LYX - 1n).toString() },
      { hashlock: '00'.repeat(32) },
      { recipient: addressFromPrivateKey(MALLORY) },
    ]) {
      const { alice, bob, w } = start('sell-lyx');
      lockLyx(w, alice, (step(alice, w) as { refundHeight: number }).refundHeight, bad);
      mineLyx(w, 3);
      w.lock!.status = 'open';
      expect(step(bob, w).kind).toBe('unsafe');
    }
  });

  it('Bob refuses to pay when the LYX lock runs out too soon', () => {
    const { alice, bob, w } = start('sell-lyx');
    lockLyx(w, alice, w.lyxHeight + 30); // 30 minutes
    mineLyx(w, 3);
    w.lock!.status = 'open';
    expect(step(bob, w)).toMatchObject({ kind: 'unsafe' });
  });

  it('Alice refuses an acceptance whose bitcoin lock is too long', () => {
    const { alice, w } = start('sell-lyx');
    alice.accept = { ...alice.accept!, btcLocktime: w.btcTip + 6 * 60 };
    expect(step(alice, w).kind).toBe('unsafe');
  });
});

describe('buy LYX with BTC', () => {
  it('happy path', () => {
    const { alice, bob, w } = start('buy-lyx');
    expect(step(alice, w).kind).toBe('fund-other');
    expect(step(bob, w).kind).toBe('wait-other-fund');
    fund(w);
    mineBtc(w);
    const s = step(bob, w);
    expect(s.kind).toBe('lock-lyx');
    expect(step(alice, w).kind).toBe('wait-lyx-lock');
    lockLyx(w, bob, (s as { refundHeight: number }).refundHeight);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    expect(step(alice, w).kind).toBe('claim-lyx');
    expect(step(bob, w).kind).toBe('wait-claim');
    // Alice claims LYX, revealing the secret on LOKYX
    const secret = sw.knownSecret(alice, live(w, alice), ALICE)!;
    w.lock!.status = 'claimed';
    w.lock!.secret = bytesToHex(secret);
    expect(step(alice, w)).toMatchObject({ kind: 'done', got: 'lyx' });
    expect(step(bob, w)).toMatchObject({ kind: 'claim-other' });
    expect(bytesToHex(sw.knownSecret(bob, live(w, bob))!)).toBe(bytesToHex(secret));
    w.funding[0].spent = true;
    w.spend = { txid: 'ef'.repeat(32), secret, height: null };
    expect(step(bob, w)).toMatchObject({ kind: 'confirming', got: 'other' });
    mineBtc(w);
    expect(step(bob, w)).toMatchObject({ kind: 'done', got: 'other' });
  });

  it('Alice never claims: Bob takes his LYX back, Alice her bitcoin', () => {
    const { alice, bob, w } = start('buy-lyx');
    fund(w);
    mineBtc(w);
    const rh = (step(bob, w) as { refundHeight: number }).refundHeight;
    lockLyx(w, bob, rh);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    w.lyxHeight = rh - 1;
    expect(step(bob, w).kind).toBe('refund-lyx');
    expect(step(alice, w).kind).not.toBe('claim-lyx'); // too late for her to claim
    w.btcTip = sw.htlcOf(alice)!.locktime;
    expect(step(alice, w).kind).toBe('refund-other');
  });

  it('Bob won\'t lock LYX if the bitcoin lock is about to expire', () => {
    const { bob, w } = start('buy-lyx');
    fund(w);
    mineBtc(w);
    w.btcTip = sw.htlcOf(bob)!.locktime - 6 * 20; // 20 hours left, LYX lock is 24
    expect(step(bob, w).kind).toBe('unsafe');
  });
});

describe('fast refund times', () => {
  it('locks are 12 h and 4 h, and both directions can still proceed', () => {
    const sell = start('sell-lyx', 1000, 'fast');
    expect(sell.alice.offer.lyxBlocks * BLOCK).toBe(12 * 3600);
    expect(sell.alice.offer.btcBlocks).toBe(4 * 6);
    const s = step(sell.alice, sell.w);
    expect(s.kind).toBe('lock-lyx');
    lockLyx(sell.w, sell.alice, (s as { refundHeight: number }).refundHeight);
    mineLyx(sell.w, 3);
    sell.w.lock!.status = 'open';
    expect(step(sell.bob, sell.w).kind).toBe('fund-other');

    const buy = start('buy-lyx', 1000, 'fast');
    expect(step(buy.alice, buy.w).kind).toBe('fund-other');
    fund(buy.w);
    mineBtc(buy.w);
    expect(step(buy.bob, buy.w).kind).toBe('lock-lyx');
  });

  it('a responder who waits too long on a fast swap is told not to fund', () => {
    const { alice, bob, w } = start('sell-lyx', 1000, 'fast');
    const s = step(alice, w) as { refundHeight: number };
    lockLyx(w, alice, s.refundHeight);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    mineLyx(w, Math.ceil((3 * 3600) / BLOCK));
    expect(step(bob, w).kind).toBe('unsafe');
  });
});

describe('ETH swaps', () => {
  const ALICE_ETH = '0x' + 'aa'.repeat(20);
  const BOB_ETH = '0x' + 'bb'.repeat(20);
  const CONTRACT = '0x' + 'cc'.repeat(20);
  const WEI = 5n * 10n ** 16n;

  function startEth(dir: sw.Direction, now = 1_900_000_000) {
    const blocks = sw.defaultBlocks(dir, BLOCK);
    const offer = sw.makeOffer(ALICE, {
      chainId: 77702, asset: 'eth', dir, lyx: LYX, lyxBlocks: blocks.lyxBlocks,
      eth: { chainId: 31337, contract: CONTRACT, wei: WEI, hours: blocks.otherHours }, myEth: ALICE_ETH, ethNow: now,
    });
    const accept = sw.makeAccept(BOB, sw.parseOffer(sw.offerCode(offer)), now, BOB_ETH);
    const alice: sw.SwapRecord = { offer, accept: sw.parseAccept(sw.acceptCode(accept), offer), role: 'initiator', updated: 0 };
    const bob: sw.SwapRecord = { offer, accept, role: 'responder', updated: 0 };
    const e: eth.EthLockState = { tip: 100, now, open: null, claimed: null, refunded: null };
    const w: World = { lyxHeight: 500, btcTip: 0, funding: [] };
    return { alice, bob, e, w };
  }
  const liveE = (w: World, e: eth.EthLockState, r: sw.SwapRecord): sw.Live => ({
    lyxHeight: w.lyxHeight, lyxBlockTime: BLOCK, lyx: w.lock ? { ...w.lock, height: w.lyxHeight } : undefined, eth: e, leg: sw.ethLeg(r, e),
  });
  const stepE = (r: sw.SwapRecord, w: World, e: eth.EthLockState) => sw.nextStep(r, liveE(w, e, r));

  it('both sides compute the same lock id, and it changes with any term', () => {
    const { alice, bob } = startEth('sell-lyx');
    const a = sw.ethLockOf(alice)!;
    const b = sw.ethLockOf(bob)!;
    expect(a.id).toBe(b.id);
    expect(a.sender).toBe(BOB_ETH);
    expect(a.recipient).toBe(ALICE_ETH);
    expect(eth.lockId(a.sender, a.recipient, alice.offer.hashlock, a.refundTime, a.amount + 1n)).not.toBe(a.id);
    expect(eth.lockId(a.sender, ALICE_ETH.replace('aa', 'ab'), alice.offer.hashlock, a.refundTime, a.amount)).not.toBe(a.id);
  });

  it('sell LYX for ETH: happy path', () => {
    const { alice, bob, e, w } = startEth('sell-lyx');
    const s = stepE(alice, w, e);
    expect(s.kind).toBe('lock-lyx');
    lockLyx(w, alice, (s as { refundHeight: number }).refundHeight);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    expect(stepE(bob, w, e).kind).toBe('fund-other');
    e.open = { amount: WEI, confirmations: 1 };
    expect(stepE(alice, w, e).kind).toBe('wait-other-fund');
    expect(stepE(bob, w, e).kind).toBe('wait-other-fund');
    e.open.confirmations = 2;
    expect(stepE(alice, w, e).kind).toBe('claim-other');
    const secret = sw.knownSecret(alice, liveE(w, e, alice), ALICE)!;
    e.open = null;
    e.claimed = { secret, confirmations: 0 };
    expect(stepE(alice, w, e)).toMatchObject({ kind: 'confirming', got: 'other' });
    expect(stepE(bob, w, e).kind).toBe('claim-lyx');
    expect(bytesToHex(sw.knownSecret(bob, liveE(w, e, bob))!)).toBe(bytesToHex(secret));
  });

  it('a lock with the wrong amount never counts as funded', () => {
    const { alice, bob, e, w } = startEth('sell-lyx');
    lockLyx(w, alice, (stepE(alice, w, e) as { refundHeight: number }).refundHeight);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    e.open = { amount: WEI - 1n, confirmations: 10 };
    expect(stepE(alice, w, e).kind).not.toBe('claim-other');
    expect(stepE(bob, w, e).kind).not.toBe('done');
  });

  it('a claim event with a secret that does not hash to the lock is ignored', () => {
    const { alice, e, w } = startEth('sell-lyx');
    e.claimed = { secret: new Uint8Array(32).fill(7), confirmations: 3 };
    expect(sw.ethLeg(alice, e).claimedSecret).toBeNull();
    expect(stepE(alice, w, e).kind).not.toBe('done');
  });

  it('buy LYX with ETH: happy path, then refunds when nobody claims', () => {
    const { alice, bob, e, w } = startEth('buy-lyx');
    expect(stepE(alice, w, e).kind).toBe('fund-other');
    expect(stepE(bob, w, e).kind).toBe('wait-other-fund');
    e.open = { amount: WEI, confirmations: 2 };
    const s = stepE(bob, w, e);
    expect(s.kind).toBe('lock-lyx');
    lockLyx(w, bob, (s as { refundHeight: number }).refundHeight);
    mineLyx(w, 3);
    w.lock!.status = 'open';
    expect(stepE(alice, w, e).kind).toBe('claim-lyx');
    // nobody claims: Bob's LYX comes back first, Alice's ETH later
    w.lyxHeight = w.lock!.refundHeight - 1;
    expect(stepE(bob, w, e).kind).toBe('refund-lyx');
    e.now = sw.ethLockOf(alice)!.refundTime;
    expect(stepE(alice, w, e).kind).toBe('refund-other');
  });
});
