// Atomic swaps on the phone: LYX <-> BTC and LYX <-> ETH, with the same codes as the website, so a phone
// can swap with a browser or another phone. The rules are in swap-core.ts (copied from the website and
// tested with the website's own tests); this file keeps the swaps, reads the chains and does each step.
//
// Nothing secret is stored: the swap secret and bitcoin keys are worked out from the LOKYX key and the
// swap's salt every time they're needed. Bitcoin and Ether are paid and claimed with this phone's own keys.

import { hexToBytes } from '@noble/hashes/utils.js';
import { privateKeyToAccount } from 'viem/accounts';
import * as sw from './swap-core';
import * as sbtc from './swap-btc';
import * as seth from './swap-eth';
import { SWAP_BYTECODE } from './swap-contract';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { switchHooks } from './ns';
import { rpc, type ChainInfo } from './rpc';
import { readPhrase, sendSwap, withLyxKey } from './wallet';
import { btcKey, ethKey, ETH_NETS, formatBtc, formatUnits, signBtc, type BtcNet } from './multichain-core';
import { formatLyx } from './lokyx';
import { btcRates, btcUtxos, chainSettings, ensureAddresses, ethFees } from './multichain';
import { keyHex } from './ethvault-core';

export { sw };

export const otherText = (o: sw.Offer) => (sw.assetOf(o) === 'btc' ? `${formatBtc(BigInt(o.sats!))} BTC` : `${formatUnits(BigInt(o.eth!.wei), 18, 6)} ETH`);
export const lyxText = (o: sw.Offer) => `${formatLyx(o.lyx, 6)} LYX`;
/** "1.5 LYX for 0.0004 BTC", from this side's point of view: what I give first. */
export const swapTitle = (r: sw.SwapRecord) => (sw.locksLyx(r) ? `${lyxText(r.offer)} for ${otherText(r.offer)}` : `${otherText(r.offer)} for ${lyxText(r.offer)}`);

// ---------- the list of swaps ----------

const KEY = 'w.swaps';
export const swaps = store<sw.SwapRecord[]>([]);
export const useSwaps = () => useStore(swaps);
const idOf = (r: sw.SwapRecord) => `${r.offer.salt}:${r.role}`;
export const swapId = idOf;

export async function loadSwaps() {
  try {
    swaps.set(JSON.parse((await getItem(KEY)) || '[]'));
  } catch {
    swaps.set([]);
  }
}
switchHooks.push(loadSwaps);

export async function saveSwap(r: sw.SwapRecord) {
  const next = [{ ...r, updated: Date.now() }, ...swaps.get().filter((x) => idOf(x) !== idOf(r))];
  swaps.set(next);
  await setItem(KEY, JSON.stringify(next));
}
export async function removeSwap(r: sw.SwapRecord) {
  const next = swaps.get().filter((x) => idOf(x) !== idOf(r));
  swaps.set(next);
  await setItem(KEY, JSON.stringify(next));
}

// ---------- settings ----------

export interface SwapSettings {
  /** Bitcoin network for new offers. The website swaps on testnet4. */
  btcNet: 'testnet4' | 'signet';
  /** The LokyxSwap contract on Sepolia, for offers you make. Offers you accept name their own (checked). */
  ethContract: string;
  /** The offer board contract on LOKYX. Empty means the default (BOARD_DEFAULT in board.ts). */
  board?: string;
  /** A board this phone is making: the deploy transaction, until it is mined and `board` is set. */
  boardPending?: string;
}
const CFG = 'w.swapcfg';
export const swapSettings = store<SwapSettings>({ btcNet: 'testnet4', ethContract: '' });
export const useSwapSettings = () => useStore(swapSettings);
export async function loadSwapSettings() {
  try {
    swapSettings.set({ ...swapSettings.get(), ...JSON.parse((await getItem(CFG)) || '{}') });
  } catch {}
}
switchHooks.push(loadSwapSettings);
export async function updateSwapSettings(p: Partial<SwapSettings>) {
  swapSettings.set({ ...swapSettings.get(), ...p });
  await setItem(CFG, JSON.stringify(swapSettings.get()));
}

// ---------- chains ----------

const SEPOLIA = ETH_NETS.sepolia.chainId;
const evmNet = (chainId: number): seth.EvmNet => {
  if (chainId !== SEPOLIA) throw new Error(`This swap uses EVM chain ${chainId}. The phone swaps on Sepolia only.`);
  return { chainId, name: 'Sepolia', rpc: chainSettings.get().ethRpc.sepolia || ETH_NETS.sepolia.rpc, contract: swapSettings.get().ethContract, symbol: 'ETH' };
};
const btcApi = (n: sbtc.BtcNet) => {
  if (n !== 'testnet4' && n !== 'signet') throw new Error(`This swap uses bitcoin ${n}, which the phone doesn't swap on.`);
  return (chainSettings.get().esplora[n] || sbtc.DEFAULT_BTC_API[n]).replace(/\/+$/, '');
};

async function ethRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(evmNet(SEPOLIA).rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

/** A Sepolia transaction from this phone's Ethereum address. Returns its hash. */
async function ethSend(to: string | null, data: string, value = 0n): Promise<string> {
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = ethKey(phrase);
  try {
    const acct = privateKeyToAccount(keyHex(k.sk));
    const probe: Record<string, string> = { from: acct.address, data, value: `0x${value.toString(16)}` };
    if (to) probe.to = to;
    const [nonce, fees, est] = await Promise.all([
      ethRpc<string>('eth_getTransactionCount', [acct.address, 'pending']),
      ethFees('sepolia'),
      ethRpc<string>('eth_estimateGas', [probe]),
    ]);
    const f = fees.normal;
    const raw = await acct.signTransaction({
      type: 'eip1559', chainId: SEPOLIA, nonce: Number(BigInt(nonce)), ...(to ? { to: to as `0x${string}` } : {}), value, data: data as `0x${string}`,
      gas: (BigInt(est) * 125n) / 100n, maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas,
    });
    return ethRpc<string>('eth_sendRawTransaction', [raw]);
  } finally {
    k.sk.fill(0);
  }
}

/** Puts the LokyxSwap contract on Sepolia from this phone (once), and remembers its address. */
export async function deployContract(): Promise<string> {
  const hash = await ethSend(null, SWAP_BYTECODE);
  for (let i = 0; i < 80; i++) {
    const r = await ethRpc<{ contractAddress: string; status: string } | null>('eth_getTransactionReceipt', [hash]);
    if (r) {
      if (r.status !== '0x1') throw new Error('The contract could not be created');
      await updateSwapSettings({ ethContract: r.contractAddress });
      return r.contractAddress;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('Still waiting for Sepolia; try again in a minute');
}

export const checkContract = (address: string) => seth.verifyContract(evmNet(SEPOLIA), address);

// ---------- making and accepting ----------

export interface NewOffer {
  dir: sw.Direction;
  asset: sw.Asset;
  lyx: bigint;
  /** sats or wei */
  other: bigint;
  speed: sw.Speed;
}

export async function makeOffer(p: NewOffer): Promise<sw.SwapRecord> {
  const info = await rpc<ChainInfo>('lyx_chainInfo');
  const blocks = sw.defaultBlocks(p.dir, info.targetBlockTime, p.speed);
  let ethFromBlock: number | undefined;
  let offer: sw.Offer;
  if (p.asset === 'btc') {
    if (p.other <= BigInt(sbtc.DUST * 3)) throw new Error('The bitcoin amount is too small to cover fees');
    const net = swapSettings.get().btcNet;
    const btcTip = p.dir === 'buy-lyx' ? await sbtc.tipHeight(btcApi(net)) : undefined;
    offer = await withLyxKey((sk) => sw.makeOffer(sk, { chainId: info.chainId, asset: 'btc', dir: p.dir, lyx: p.lyx, lyxBlocks: blocks.lyxBlocks, btcNet: net, sats: Number(p.other), btcBlocks: blocks.btcBlocks, btcTip }));
  } else {
    const net = evmNet(SEPOLIA);
    if (!net.contract) throw new Error('Set up the swap contract first (Swap settings)');
    if (!(await seth.verifyContract(net, net.contract))) throw new Error('The swap contract in settings is not the LOKYX swap contract');
    const [head, a] = await Promise.all([seth.latest(net), ensureAddresses()]);
    ethFromBlock = Math.max(0, head.number - 5);
    offer = await withLyxKey((sk) => sw.makeOffer(sk, {
      chainId: info.chainId, asset: 'eth', dir: p.dir, lyx: p.lyx, lyxBlocks: blocks.lyxBlocks,
      eth: { chainId: SEPOLIA, contract: net.contract, wei: p.other, hours: blocks.otherHours }, myEth: a.eth, ethNow: head.timestamp,
    }));
  }
  const r: sw.SwapRecord = { offer, role: 'initiator', ethFromBlock, updated: Date.now() };
  await saveSwap(r);
  return r;
}

/** Reads an offer code and checks it can be taken here. Throws a plain message when it can't. */
export async function readOffer(code: string, me: string): Promise<sw.Offer> {
  const o = sw.parseOffer(code);
  const info = await rpc<ChainInfo>('lyx_chainInfo');
  if (o.chainId !== info.chainId) throw new Error(`This offer is for LOKYX chain ${o.chainId}, not the one this phone uses`);
  if (o.initLyx === me) throw new Error('This is your own offer');
  if (sw.assetOf(o) === 'btc') btcApi(o.btcNet!);
  else evmNet(o.eth!.chainId);
  return o;
}

export async function acceptOffer(o: sw.Offer): Promise<sw.SwapRecord> {
  const info = await rpc<ChainInfo>('lyx_chainInfo');
  const lyxHours = (o.lyxBlocks * info.targetBlockTime) / 3600;
  let a: sw.Accept;
  let ethFromBlock: number | undefined;
  if (sw.assetOf(o) === 'btc') {
    const tip = await sbtc.tipHeight(btcApi(o.btcNet!));
    if (o.dir === 'buy-lyx' && (o.btcLocktime! - tip) / 6 < lyxHours + sw.MARGIN_HOURS + 1) throw new Error('This offer is too old. Ask for a new one.');
    a = await withLyxKey((sk) => sw.makeAccept(sk, o, tip));
  } else {
    const net = evmNet(o.eth!.chainId);
    // the offer names a contract: make sure it really is the swap contract, not one that keeps the money
    if (!(await seth.verifyContract(net, o.eth!.contract))) throw new Error('The contract in this offer is NOT the LOKYX swap contract. Do not accept it.');
    const [head, me] = await Promise.all([seth.latest(net), ensureAddresses()]);
    if (o.dir === 'buy-lyx' && (o.ethRefundTime! - head.timestamp) / 3600 < lyxHours + sw.MARGIN_HOURS + 1) throw new Error('This offer is too old. Ask for a new one.');
    ethFromBlock = Math.max(0, head.number - 5);
    a = await withLyxKey((sk) => sw.makeAccept(sk, o, head.timestamp, me.eth));
  }
  const r: sw.SwapRecord = { offer: o, accept: a, role: 'responder', ethFromBlock, updated: Date.now() };
  await saveSwap(r);
  return r;
}

export async function takeAccept(r: sw.SwapRecord, code: string) {
  const next = { ...r, accept: sw.parseAccept(code, r.offer) };
  await saveSwap(next);
  return next;
}

// ---------- where things stand ----------

const NO_LEG: sw.Leg = { hoursLeft: 99, expired: false, funded: false, anyFunding: false, claimedSecret: null, refunded: false, closeConfirmed: false, received: 0n };

export async function readLive(r: sw.SwapRecord): Promise<{ live: sw.Live; record: sw.SwapRecord }> {
  const info = await rpc<ChainInfo>('lyx_chainInfo');
  let record = r;
  let lyx: sw.LyxSwapView | undefined;
  let id = r.lyxLockId;
  if (!id && r.accept) {
    const ids = await rpc<string[]>('lyx_findSwaps', { hashlock: r.offer.hashlock });
    id = ids[0];
    if (id) {
      record = { ...r, lyxLockId: id };
      await saveSwap(record);
    }
  }
  if (id) lyx = await rpc<sw.LyxSwapView>('lyx_getSwap', { id }).catch(() => undefined);
  const base = { lyxHeight: info.height, lyxBlockTime: info.targetBlockTime, lyx };
  if (!record.accept) return { live: { ...base, leg: NO_LEG }, record };
  if (sw.assetOf(record.offer) === 'btc') {
    const htlc = sw.htlcOf(record)!;
    const btcAddress = sbtc.htlcAddress(htlc, record.offer.btcNet!);
    const b = await sbtc.watchHtlc(btcApi(record.offer.btcNet!), btcAddress, hexToBytes(record.offer.hashlock));
    return { live: { ...base, btc: b, btcAddress, leg: sw.btcLeg(record, b) }, record };
  }
  const lock = sw.ethLockOf(record)!;
  const e = await seth.watchLock(evmNet(record.offer.eth!.chainId), record.offer.eth!.contract, lock.id, record.ethFromBlock ?? 0);
  return { live: { ...base, eth: e, leg: sw.ethLeg(record, e) }, record };
}

// ---------- doing each step ----------

export async function lockLyx(r: sw.SwapRecord, refundHeight: number) {
  const p = sw.lyxParties(r)!;
  const id = await sendSwap({ kind: 'lock', hashlock: hexToBytes(r.offer.hashlock), recipient: p.recipient, refundHeight: BigInt(refundHeight) }, BigInt(r.offer.lyx));
  await saveSwap({ ...r, lyxLockId: id });
}

export async function claimLyx(r: sw.SwapRecord, live: sw.Live, lockId: string) {
  const secret = await withLyxKey((sk) => sw.knownSecret(r, live, sk));
  if (!secret) throw new Error("The secret hasn't shown up yet");
  await saveSwap({ ...r, lyxCloseTx: await sendSwap({ kind: 'claim', lock: hexToBytes(lockId), secret }) });
}

export async function refundLyx(r: sw.SwapRecord, lockId: string) {
  await saveSwap({ ...r, lyxCloseTx: await sendSwap({ kind: 'refund', lock: hexToBytes(lockId) }) });
}

const myBtc = async (net: BtcNet) => (await ensureAddresses()).btc[net];
const rateFor = async (net: BtcNet) => (await btcRates(net)).normal;

/** Pays the bitcoin into the swap contract from this phone's bitcoin address. */
export async function fundOther(r: sw.SwapRecord, live: sw.Live) {
  if (sw.assetOf(r.offer) === 'eth') {
    const l = sw.ethLockOf(r)!;
    const me = (await ensureAddresses()).eth;
    // the lock id commits to the sender, so it has to come from the address in the deal
    if (me.toLowerCase() !== l.sender.toLowerCase()) throw new Error('This swap was set up with a different Ethereum address');
    await saveSwap({ ...r, ethTx: await ethSend(r.offer.eth!.contract, seth.encodeLock(r.offer.hashlock, l.recipient, l.refundTime), l.amount) });
    return;
  }
  const net = r.offer.btcNet as BtcNet;
  const from = await myBtc(net);
  const [utxos, rate] = await Promise.all([btcUtxos(net, from), rateFor(net)]);
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = btcKey(phrase, net);
  try {
    const signed = signBtc({ sk: k.sk, from, to: live.btcAddress!, net, utxos, amount: BigInt(r.offer.sats!), rate });
    await sbtc.broadcast(btcApi(r.offer.btcNet!), signed.hex);
    await saveSwap({ ...r, notes: `funded ${signed.txid}` });
  } finally {
    k.sk.fill(0);
  }
}

const btcUtxo = (live: sw.Live) => live.btc?.funding.filter((f) => !f.spent).sort((a, b) => b.value - a.value)[0];

/** Takes the other coin with the secret, to this phone's own address. */
export async function claimOther(r: sw.SwapRecord, live: sw.Live) {
  const secret = await withLyxKey((sk) => sw.knownSecret(r, live, sk));
  if (!secret) throw new Error("The secret hasn't shown up yet");
  if (sw.assetOf(r.offer) === 'btc') {
    const net = r.offer.btcNet as BtcNet;
    const u = btcUtxo(live);
    if (!u) throw new Error('Nothing to claim yet');
    const to = await myBtc(net);
    const rate = Math.max(1, Math.ceil(await rateFor(net).catch(() => 2)));
    const t = await withLyxKey((sk) => sbtc.buildClaim(sw.htlcOf(r)!, u, secret, sw.myBtcKey(sk, r), to, rate, r.offer.btcNet!));
    await sbtc.broadcast(btcApi(r.offer.btcNet!), t.hex);
    await saveSwap({ ...r, btcClaimTx: t.txid });
  } else {
    // anyone may send the claim; the ether always goes to the agreed recipient
    await saveSwap({ ...r, ethTx: await ethSend(r.offer.eth!.contract, seth.encodeClaim(sw.ethLockOf(r)!.id, secret)) });
  }
}

/** Takes the other coin back after its time ran out. */
export async function refundOther(r: sw.SwapRecord, live: sw.Live) {
  if (sw.assetOf(r.offer) === 'btc') {
    const net = r.offer.btcNet as BtcNet;
    const u = btcUtxo(live);
    if (!u) throw new Error('Nothing to refund');
    const to = await myBtc(net);
    const rate = await rateFor(net).catch(() => 2);
    const t = await withLyxKey((sk) => sbtc.buildRefund(sw.htlcOf(r)!, u, sw.myBtcKey(sk, r), to, Math.max(1, Math.ceil(rate)), r.offer.btcNet!));
    await sbtc.broadcast(btcApi(r.offer.btcNet!), t.hex);
    await saveSwap({ ...r, btcRefundTx: t.txid });
  } else {
    await saveSwap({ ...r, ethTx: await ethSend(r.offer.eth!.contract, seth.encodeRefund(sw.ethLockOf(r)!.id)) });
  }
}
