// Bitcoin and Ethereum on the phone: settings, public addresses (cached), balances and sending through
// public endpoints that need no key. The signing rules live in multichain-core.ts.

import { ensureApps } from './appswallet';
import { switchHooks } from './ns';
import { plainError } from './plain-error';
import { useCallback, useEffect, useState } from 'react';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { readPhrase, resetHooks, wallet } from './wallet';
import {
  allAddresses, formatBtc, formatUnits, BTC_NETS, DEFAULT_CHAIN_SETTINGS, ETH_NETS, ERC20_ABI, assertAllowed, btcKey, effective, ethFeeChoices, ethKey, pickFeeRates, signBtc, signEth,
  tokenId, KNOWN_TOKENS, BLOCKSCOUT, parseEthTxs, parseTokenTxs, type EthTxRow, type BtcNet, type ChainSettings, type EthNet, type EthToken, type Fees, type Speed, type Utxo,
} from './multichain-core.ts';
import { decodeFunctionResult, encodeFunctionData, type Hex } from 'viem';
import { parseSimulate, parseTrace, type Run } from './preview-core';
import { privateKeyToAccount } from 'viem/accounts';

// ---------- settings ----------

export const chainSettings = store<ChainSettings>(DEFAULT_CHAIN_SETTINGS);
export const useChainSettings = () => useStore(chainSettings);
export const activeNets = () => effective(chainSettings.get());

export async function loadChains() {
  try {
    const raw = await getItem('w.chains');
    if (raw) chainSettings.set({ ...DEFAULT_CHAIN_SETTINGS, ...JSON.parse(raw) });
  } catch {}
}
export async function updateChains(p: Partial<ChainSettings>) {
  const next = { ...chainSettings.get(), ...p };
  chainSettings.set(next);
  await setItem('w.chains', JSON.stringify(next));
}

/** fetch that gives up after a while, so a dead connection ends in a clear message instead of a screen that never finishes */
export async function fetchT(url: string, init?: RequestInit, ms = 15_000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const esplora = (n: BtcNet) => (chainSettings.get().esplora[n] || BTC_NETS[n].esplora).replace(/\/+$/, '');
const ethRpcUrl = (n: EthNet) => chainSettings.get().ethRpc[n] || ETH_NETS[n].rpc;

// ---------- public addresses ----------

export interface Addrs {
  btc: Record<BtcNet, string>;
  eth: string;
  /** made with the others since Solana and Tron were added; wallets from before get them on first use */
  sol?: string;
  trx?: string;
}
export const addrs = store<Addrs | null>(null);

/** The wallet account in use. Account 0 is the original one; each new account has its own address on every coin. */
const curAcct = () => wallet.get().current;
const addrKey = (acct: number) => (acct === 0 ? 'w.addrs' : `w.addrs.${acct}`);

/** Derive and remember the public addresses of one account (needs the phone's check once; the keys are not kept). */
const deriving = new Map<number, Promise<Addrs>>();
const cached = new Map<number, Addrs>();
/** The addresses of the account in use. Several screens ask at once; they share one derivation, so the phone asks for your fingerprint once. */
export function ensureAddresses(): Promise<Addrs> {
  return addrsFor(curAcct());
}
/**
 * The addresses of the account in use, for a screen. It looks them up again whenever the account in use changes, and never
 * hands back the previous account's addresses while the new ones load.
 */
export function useMyAddresses() {
  const idx = useStore(wallet).current;
  const r = useAsync(async () => (wallet.get().exists ? { i: idx, a: await addrsFor(idx) } : null), [idx]);
  const data = r.data && r.data.i === idx ? r.data.a : undefined;
  return { data, error: r.error, refresh: r.refresh };
}
/** The first account's addresses. Vaults, shared accounts and swaps belong to it, whichever account is in use. */
export const ensurePrimary = (): Promise<Addrs> => addrsFor(0);

function addrsFor(acct: number): Promise<Addrs> {
  const have = cached.get(acct);
  if (have) return Promise.resolve(have);
  let p = deriving.get(acct);
  if (!p) {
    p = deriveAddresses(acct).finally(() => deriving.delete(acct));
    deriving.set(acct, p);
  }
  return p;
}
const publish = (acct: number, a: Addrs) => {
  cached.set(acct, a);
  if (acct === curAcct()) addrs.set(a);
};
async function deriveAddresses(acct: number): Promise<Addrs> {
  try {
    const raw = await getItem(addrKey(acct));
    if (raw) {
      const a = JSON.parse(raw) as Addrs;
      // every test network uses the same key and the same tb1 address (testnet4 came later)
      if (!a.btc.testnet4) a.btc.testnet4 = a.btc.signet;
      publish(acct, a);
      return a;
    }
  } catch {}
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const out: Addrs = await new Promise((res, rej) => setTimeout(() => { try { res(allAddresses(phrase, acct)); } catch (e) { rej(e); } }, 30));
  publish(acct, out);
  await setItem(addrKey(acct), JSON.stringify(out));
  return out;
}
/** Solana and Tron addresses for a wallet made before they existed: needs the words once, like the first time. */
let extraing: Promise<Addrs> | null = null;
export function ensureExtraAddresses(): Promise<Addrs> {
  if (!extraing)
    extraing = (async () => {
      const acct = curAcct();
      const a = await addrsFor(acct);
      if (a.sol && a.trx) return a;
      const phrase = await readPhrase();
      if (!phrase) throw new Error('No recovery words on this phone');
      const all: Addrs = await new Promise((res, rej) => setTimeout(() => { try { res(allAddresses(phrase, acct)); } catch (e) { rej(e); } }, 30));
      const out = { ...a, sol: all.sol, trx: all.trx };
      publish(acct, out);
      await setItem(addrKey(acct), JSON.stringify(out));
      return out;
    })().finally(() => { extraing = null; });
  return extraing;
}
resetHooks.push(() => { addrs.set(null); cached.clear(); });
switchHooks.push(async () => {
  addrs.set(cached.get(curAcct()) ?? null);
  await loadTokens();
});

export const forgetAddresses = async () => {
  addrs.set(null);
  cached.clear();
  await setItem('w.addrs', '');
};

// ---------- destinations used before (for address-poisoning checks) ----------

export async function knownDestinations(chain: 'btc' | 'eth' | 'sol' | 'trx'): Promise<string[]> {
  try {
    return JSON.parse((await getItem(`w.dest.${chain}`)) ?? '[]');
  } catch {
    return [];
  }
}
export async function rememberDestination(chain: 'btc' | 'eth' | 'sol' | 'trx', a: string) {
  const list = (await knownDestinations(chain)).filter((x) => x.toLowerCase() !== a.toLowerCase());
  list.unshift(a);
  await setItem(`w.dest.${chain}`, JSON.stringify(list.slice(0, 50)));
}

// ---------- Bitcoin via Esplora ----------

async function getJson<T>(url: string): Promise<T> {
  const r = await fetchT(url);
  if (!r.ok) throw new Error(`The block explorer answered ${r.status}`);
  return (await r.json()) as T;
}

interface EsploraAddr {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
}
export async function btcBalance(net: BtcNet, address: string): Promise<{ confirmed: bigint; pending: bigint }> {
  const a = await getJson<EsploraAddr>(`${esplora(net)}/address/${address}`);
  const c = BigInt(a.chain_stats.funded_txo_sum) - BigInt(a.chain_stats.spent_txo_sum);
  const m = BigInt(a.mempool_stats.funded_txo_sum) - BigInt(a.mempool_stats.spent_txo_sum);
  return { confirmed: c, pending: m };
}
export async function btcUtxos(net: BtcNet, address: string): Promise<Utxo[]> {
  const l = await getJson<{ txid: string; vout: number; value: number }[]>(`${esplora(net)}/address/${address}/utxo`);
  return l.map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value) }));
}
export interface BtcTxRow {
  txid: string;
  confirmed: boolean;
  time?: number;
  /** positive = received, negative = sent (sats) */
  delta: bigint;
}
export async function btcHistory(net: BtcNet, address: string): Promise<BtcTxRow[]> {
  const l = await getJson<{ txid: string; status: { confirmed: boolean; block_time?: number }; vin: { prevout?: { scriptpubkey_address?: string; value: number } }[]; vout: { scriptpubkey_address?: string; value: number }[] }[]>(`${esplora(net)}/address/${address}/txs`);
  return l.map((t) => {
    const out = t.vout.filter((o) => o.scriptpubkey_address === address).reduce((a, o) => a + BigInt(o.value), 0n);
    const inn = t.vin.filter((i) => i.prevout?.scriptpubkey_address === address).reduce((a, i) => a + BigInt(i.prevout!.value), 0n);
    return { txid: t.txid, confirmed: t.status.confirmed, time: t.status.block_time, delta: out - inn };
  });
}
/** Payments in or out of the Ethereum address on one network, newest first. A token gives that token's moves only. */
export async function ethHistory(net: EthNet, address: string, token?: EthToken): Promise<EthTxRow[]> {
  if (!BLOCKSCOUT[net]) return []; // no free history service for this network: the coin screen links to its explorer
  const base = `${BLOCKSCOUT[net]}/api/v2/addresses/${address}`;
  if (token) return parseTokenTxs(await getJson<unknown>(`${base}/token-transfers?type=ERC-20&token=${token.contract}`), address).map((r) => ({ ...r, symbol: r.symbol || token.symbol }));
  return parseEthTxs(await getJson<unknown>(`${base}/transactions`), address, ETH_NETS[net].unit);
}
export async function btcRates(net: BtcNet): Promise<Record<Speed, number>> {
  return pickFeeRates(await getJson<Record<string, number>>(`${esplora(net)}/fee-estimates`));
}

/** Build and sign with the key from the 24 words (read for this one signing and wiped). */
export async function prepareBtc(to: string, amount: bigint, speed: Speed) {
  const net = activeNets().btc;
  assertAllowed(chainSettings.get(), 'btc', net);
  const acct = curAcct();
  const a = await addrsFor(acct);
  const from = a.btc[net];
  const [utxos, rates] = await Promise.all([btcUtxos(net, from), btcRates(net)]);
  const rate = rates[speed];
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = btcKey(phrase, net, 0, acct);
  try {
    const signed = signBtc({ sk: k.sk, from, to, net, utxos, amount, rate });
    return { net, from, rate, signed };
  } finally {
    k.sk.fill(0);
  }
}
const ownSend = () => { import('./watch').then((m) => m.markOwnSend()).catch(() => {}); };
export async function broadcastBtc(net: BtcNet, hex: string): Promise<string> {
  const r = await fetchT(`${esplora(net)}/tx`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: hex });
  const t = await r.text();
  if (!r.ok) throw new Error(`The network refused it: ${t.slice(0, 160)}`);
  ownSend();
  return t.trim();
}

// ---------- Ethereum via JSON-RPC ----------

let rid = 0;
async function eth<T>(net: EthNet, method: string, params: unknown[] = []): Promise<T> {
  const r = await fetchT(ethRpcUrl(net), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  if (!r.ok) throw new Error(`The Ethereum node answered ${r.status}`);
  const b = await r.json();
  if (b.error) throw new Error(b.error.message);
  return b.result as T;
}

const verified = new Map<string, number>();
/** Refuse an endpoint that is on a different chain than the one chosen. */
async function checkEth(net: EthNet) {
  const url = ethRpcUrl(net);
  if (verified.get(url) === ETH_NETS[net].chainId) return;
  const id = Number(BigInt(await eth<string>(net, 'eth_chainId')));
  if (id !== ETH_NETS[net].chainId) throw new Error(`That Ethereum endpoint is on chain ${id}, not ${ETH_NETS[net].chainId}.`);
  verified.set(url, id);
}

/** A read a website asked for, passed to the chosen Ethereum network as it is. */
export async function ethPass(net: EthNet, method: string, params: unknown[] = []): Promise<unknown> {
  await checkEth(net);
  return eth<unknown>(net, method, params);
}

export async function ethBalance(net: EthNet, address: string): Promise<bigint> {
  await checkEth(net);
  return BigInt(await eth<string>(net, 'eth_getBalance', [address, 'latest']));
}
export async function tokenBalance(net: EthNet, t: EthToken, owner: string): Promise<bigint> {
  await checkEth(net);
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner as Hex] });
  const out = await eth<Hex>(net, 'eth_call', [{ to: t.contract, data }, 'latest']);
  return decodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', data: out }) as bigint;
}
/** Look a token up by its contract address: its symbol and decimals come from the chain. */
export async function lookupToken(net: EthNet, contract: string): Promise<EthToken> {
  await checkEth(net);
  const call = async (fn: 'symbol' | 'decimals') => decodeFunctionResult({ abi: ERC20_ABI, functionName: fn, data: await eth<Hex>(net, 'eth_call', [{ to: contract, data: encodeFunctionData({ abi: ERC20_ABI, functionName: fn }) }, 'latest']) });
  const [symbol, decimals] = await Promise.all([call('symbol'), call('decimals')]);
  return { chainId: ETH_NETS[net].chainId, contract, symbol: String(symbol), decimals: Number(decimals) };
}

export const customTokens = store<EthToken[]>([]);
export async function loadTokens() {
  try { customTokens.set(JSON.parse((await getItem('w.ethtokens')) ?? '[]')); } catch {}
}
export async function addToken(t: EthToken) {
  if (customTokens.get().some((x) => tokenId(x) === tokenId(t))) return;
  customTokens.set([...customTokens.get(), t]);
  await setItem('w.ethtokens', JSON.stringify(customTokens.get()));
}
export async function removeToken(t: EthToken) {
  customTokens.set(customTokens.get().filter((x) => tokenId(x) !== tokenId(t)));
  await setItem('w.ethtokens', JSON.stringify(customTokens.get()));
}
/** The tokens in the wallet on one network: only ones the person added (the token list is not the wallet). */
export const tokensFor = (net: EthNet) => customTokens.get().filter((t) => t.chainId === ETH_NETS[net].chainId).filter((t, i, a) => a.findIndex((x) => tokenId(x) === tokenId(t)) === i);
export const useTokensStore = () => useStore(customTokens);

export async function ethFees(net: EthNet): Promise<Record<Speed, Fees>> {
  await checkEth(net);
  const block = await eth<{ baseFeePerGas?: string }>(net, 'eth_getBlockByNumber', ['latest', false]);
  const tip = BigInt(await eth<string>(net, 'eth_maxPriorityFeePerGas').catch(() => '0x59682f00'));
  return ethFeeChoices(BigInt(block.baseFeePerGas ?? '0x3b9aca00'), tip);
}

export async function prepareEth(to: string, amount: bigint, speed: Speed, token?: EthToken, onNet?: EthNet) {
  const net = onNet ?? activeNets().eth;
  assertAllowed(chainSettings.get(), 'eth', net);
  const acct = curAcct();
  const a = await addrsFor(acct);
  const [nonce, fees] = await Promise.all([eth<string>(net, 'eth_getTransactionCount', [a.eth, 'pending']), ethFees(net)]);
  const probe: { from: string; to: string; value?: string; data?: string } = token
    ? { from: a.eth, to: token.contract, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to as Hex, amount] }) }
    : { from: a.eth, to, value: `0x${amount.toString(16)}` };
  const est = BigInt(await eth<string>(net, 'eth_estimateGas', [probe]));
  const gas = (est * 120n) / 100n;
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = ethKey(phrase, 0, acct);
  try {
    const signed = await signEth({ net, sk: k.sk, nonce: Number(BigInt(nonce)), to, amount, token, gas, fees: fees[speed] });
    return { net, from: a.eth, gas, fees: fees[speed], signed, token };
  } finally {
    k.sk.fill(0);
  }
}
export async function broadcastEth(net: EthNet, raw: string): Promise<string> {
  await checkEth(net);
  const h = await eth<string>(net, 'eth_sendRawTransaction', [raw]);
  ownSend();
  return h;
}

// ---------- contract calls from your own Ethereum address (shared accounts on Safe) ----------

/** Read a contract (eth_call). */
export async function ethRead(net: EthNet, to: string, data: Hex): Promise<Hex> {
  await checkEth(net);
  return eth<Hex>(net, 'eth_call', [{ to, data }, 'latest']);
}
export async function ethCode(net: EthNet, at: string): Promise<Hex> {
  await checkEth(net);
  return eth<Hex>(net, 'eth_getCode', [at, 'latest']);
}

/**
 * Run a call on the node without signing or sending it, and say what it did. Tries eth_simulateV1 (with coin transfers
 * traced), then debug_traceCall with the call tracer. A node that has neither, or answers in a shape we do not know,
 * gives { ok: false }: the sheet then says it cannot preview. Nothing here is ever guessed.
 */
export async function ethSimulate(net: EthNet, from: string, to: string | null, data: string, value: bigint): Promise<Run> {
  await checkEth(net);
  const call = { from, ...(to ? { to } : {}), data, value: `0x${value.toString(16)}` };
  try {
    const r = parseSimulate(await eth<unknown>(net, 'eth_simulateV1', [{ blockStateCalls: [{ calls: [call] }], traceTransfers: true, validation: false }, 'latest']));
    if (r.ok) return r;
  } catch {
    /* this node does not do it: try the next way */
  }
  try {
    return parseTrace(await eth<unknown>(net, 'debug_traceCall', [call, 'latest', { tracer: 'callTracer', tracerConfig: { withLog: true } }]));
  } catch {
    return { ok: false };
  }
}

/** Sign a contract call with the key from your words and send it. Returns the transaction hash. */
export async function sendEthCall(to: string | null, data: Hex, value = 0n, onNet?: EthNet, index = 0): Promise<string> {
  const net = onNet ?? activeNets().eth;
  assertAllowed(chainSettings.get(), 'eth', net);
  await checkEth(net);
  const from = index ? await ensureApps() : (await ensurePrimary()).eth;
  const [nonce, fees, est] = await Promise.all([
    eth<string>(net, 'eth_getTransactionCount', [from, 'pending']),
    ethFees(net),
    eth<string>(net, 'eth_estimateGas', [to ? { from, to, data, value: `0x${value.toString(16)}` } : { from, data, value: `0x${value.toString(16)}` }]),
  ]);
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = ethKey(phrase, index);
  try {
    const acct = privateKeyToAccount(`0x${Array.from(k.sk, (b) => b.toString(16).padStart(2, '0')).join('')}`);
    const f = fees.normal;
    const raw = await acct.signTransaction({ type: 'eip1559', chainId: ETH_NETS[net].chainId, nonce: Number(BigInt(nonce)), ...(to ? { to: to as Hex } : {}), value, data, gas: (BigInt(est) * 130n) / 100n, maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas });
    return broadcastEth(net, raw);
  } finally {
    k.sk.fill(0);
  }
}

/** Where a contract-creating transaction put its contract, once it is mined (null while it waits). */
export async function ethCreated(net: EthNet, hash: string): Promise<string | null> {
  const r = await eth<{ contractAddress?: string; status?: string } | null>(net, 'eth_getTransactionReceipt', [hash]);
  if (!r) return null;
  if (r.status === '0x0') throw new Error('It failed on chain. Only the network fee was spent.');
  return r.contractAddress ?? null;
}

/** The key from your words as 0x hex, for one signing; the caller wipes nothing (strings can't be wiped), so keep it short-lived. */
export async function withEthKey<T>(f: (sk: Hex, address: Hex) => Promise<T>, index = 0): Promise<T> {
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = ethKey(phrase, index);
  try {
    return await f(`0x${Array.from(k.sk, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex, k.address as Hex);
  } finally {
    k.sk.fill(0);
  }
}

// ---------- moving everything out of a key that isn't the wallet's (gift cards) ----------

/** Send all the Bitcoin `sk` holds, less the fee, to `to`. Returns the txid. */
export async function sweepBtc(net: BtcNet, sk: Uint8Array, from: string, to: string): Promise<string> {
  const [utxos, rates] = await Promise.all([btcUtxos(net, from), btcRates(net)]);
  if (!utxos.length) throw new Error('This gift is empty');
  const total = utxos.reduce((a, u) => a + u.value, 0n);
  const fee = BigInt(Math.ceil((10.5 + 68 * utxos.length + 31) * rates.normal));
  if (total - fee < 294n) throw new Error('Too little is left to cover the network fee');
  const signed = signBtc({ sk, from, to, net, utxos, amount: total - fee, rate: rates.normal });
  return broadcastBtc(net, signed.hex);
}

/** Send all the ETH `sk` holds, less the gas, to `to`. Returns the transaction hash. */
export async function sweepEth(net: EthNet, sk: Uint8Array, from: string, to: string, onStep?: (s: string) => void): Promise<string> {
  onStep?.('Checking the network…');
  await checkEth(net);
  onStep?.('Reading the card and the fees…');
  const [bal, nonce, fees] = await Promise.all([ethBalance(net, from), eth<string>(net, 'eth_getTransactionCount', [from, 'pending']), ethFees(net)]);
  const f = fees.normal;
  const gas = 21_000n;
  const cost = gas * f.maxFeePerGas;
  if (bal <= cost) throw new Error(bal === 0n ? 'This gift is empty' : 'Too little is left to cover the network fee');
  onStep?.('Signing…');
  const signed = await signEth({ net, sk, nonce: Number(BigInt(nonce)), to, amount: bal - cost, gas, fees: f });
  onStep?.('Sending…');
  return broadcastEth(net, signed.raw);
}

/** The block a Bitcoin transaction is in, or null while it waits. */
export async function btcTxBlock(net: BtcNet, txid: string): Promise<number | null> {
  const r = await fetchT(`${esplora(net)}/tx/${txid}/status`);
  if (!r.ok) return null;
  const j = (await r.json()) as { confirmed?: boolean; block_height?: number };
  return j.confirmed ? (j.block_height ?? 0) : null;
}

/** The block an Ethereum transaction is in (null while it waits); throws if it was mined but reverted. */
export async function ethTxBlock(net: EthNet, hash: string): Promise<number | null> {
  const r = await eth<{ blockNumber?: string; status?: string } | null>(net, 'eth_getTransactionReceipt', [hash]);
  if (!r?.blockNumber) return null;
  if (r.status === '0x0') throw new Error('It was included in a block but failed (reverted). Only the network fee was spent.');
  return Number(BigInt(r.blockNumber));
}

// ---------- screens use these ----------

export function useAsync<T>(f: () => Promise<T>, deps: unknown[], every = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const run = useCallback(() => f().then((d) => { setData(d); setError(''); }).catch((e) => setError(plainError(e))), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    run();
    if (!every) return;
    const t = setInterval(run, every);
    return () => clearInterval(t);
  }, [run, every]);
  return { data, error, refresh: run };
}

// ---------- prices (none yet) ----------

/** Where a price source plugs in later. Test coins have no value, so nothing is wired in. */
export interface PriceSource {
  priceOf(asset: string): Promise<number | null>;
}
export const noPrices: PriceSource = { priceOf: async () => null };

// ---------- one payment in full, for the details screen ----------

export interface MoreAboutTx {
  /** network fee, already written out with its unit */
  fee?: string;
  from?: string;
  to?: string;
  /** how many blocks are on top of it; 0 while it is waiting */
  confirmations?: number;
  block?: number;
  /** unix seconds of that block */
  time?: number;
}

/** What the network says about one Bitcoin payment: the fee and how deep it is. Missing pieces are left out. */
export async function btcTxMore(net: BtcNet, txid: string): Promise<MoreAboutTx> {
  const [t, tip] = await Promise.all([
    getJson<{ fee?: number; status?: { confirmed?: boolean; block_height?: number; block_time?: number } }>(`${esplora(net)}/tx/${txid}`),
    getJson<number>(`${esplora(net)}/blocks/tip/height`).catch(() => 0),
  ]);
  const h = t.status?.confirmed ? t.status.block_height : undefined;
  return { fee: typeof t.fee === 'number' ? `${formatBtc(BigInt(t.fee))} ${BTC_NETS[net].unit}` : undefined, block: h, time: t.status?.block_time, confirmations: h && tip ? Math.max(0, tip - h + 1) : 0 };
}

/** What the network says about one Ethereum payment: who, the fee paid, and how deep it is. */
export async function ethTxMore(net: EthNet, hash: string): Promise<MoreAboutTx> {
  const [tx, rc, head] = await Promise.all([
    ethPass(net, 'eth_getTransactionByHash', [hash]) as Promise<{ from?: string; to?: string | null; blockNumber?: string | null } | null>,
    ethPass(net, 'eth_getTransactionReceipt', [hash]) as Promise<{ gasUsed?: string; effectiveGasPrice?: string; blockNumber?: string } | null>,
    ethPass(net, 'eth_blockNumber', []) as Promise<string>,
  ]);
  const out: MoreAboutTx = { from: tx?.from, to: tx?.to ?? undefined };
  if (rc?.gasUsed && rc.effectiveGasPrice) out.fee = `${formatUnits(BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice), 18, 8)} ${ETH_NETS[net].unit}`;
  const b = rc?.blockNumber ?? tx?.blockNumber;
  if (b) {
    out.block = Number(BigInt(b));
    out.confirmations = Math.max(0, Number(BigInt(head) - BigInt(b)) + 1);
    const blk = (await ethPass(net, 'eth_getBlockByNumber', [b, false]).catch(() => null)) as { timestamp?: string } | null;
    if (blk?.timestamp) out.time = Number(BigInt(blk.timestamp));
  }
  return out;
}

// ---------- moving everything out of another wallet's Ethereum key (import and protect) ----------

/**
 * Send every known token and then the coin itself from `sk` to `to`, on one network. Tokens go first because they
 * need a little coin for the fee. Returns the transaction hashes. Throws a plain message when the key has tokens
 * but not enough coin to pay the fee.
 */
export async function sweepEvm(net: EthNet, sk: Hex, to: string): Promise<string[]> {
  assertAllowed(chainSettings.get(), 'eth', net);
  await checkEth(net);
  const acct = privateKeyToAccount(sk);
  const chainId = ETH_NETS[net].chainId;
  const f = (await ethFees(net)).normal;
  let nonce = Number(BigInt(await eth<string>(net, 'eth_getTransactionCount', [acct.address, 'pending'])));
  let bal = await ethBalance(net, acct.address);
  const hashes: string[] = [];
  const fee = { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
  for (const t of KNOWN_TOKENS.filter((k) => k.chainId === chainId)) {
    const amt = await tokenBalance(net, t, acct.address);
    if (amt <= 0n) continue;
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to as Hex, amt] });
    const est = BigInt(await eth<string>(net, 'eth_estimateGas', [{ from: acct.address, to: t.contract, data }]));
    const gas = (est * 130n) / 100n;
    const cost = gas * fee.maxFeePerGas;
    if (bal < cost) throw new Error(`There is not enough ${ETH_NETS[net].unit} on ${ETH_NETS[net].label} to move the ${t.symbol}. Send a little ${ETH_NETS[net].unit} to ${acct.address.slice(0, 8)}… first.`);
    const raw = await acct.signTransaction({ type: 'eip1559', chainId, nonce, to: t.contract as Hex, value: 0n, data, gas, ...fee });
    hashes.push(await broadcastEth(net, raw));
    nonce += 1;
    bal -= cost;
  }
  const cost = 21000n * fee.maxFeePerGas;
  if (bal > cost) {
    const raw = await acct.signTransaction({ type: 'eip1559', chainId, nonce, to: to as Hex, value: bal - cost, data: '0x', gas: 21000n, ...fee });
    hashes.push(await broadcastEth(net, raw));
  }
  return hashes;
}
