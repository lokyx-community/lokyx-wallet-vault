// Solana and Tron over their public endpoints. The transactions themselves are built and signed in
// sol-core.ts and tron-core.ts; this file only reads balances, fetches a recent block, and relays.

import { activeNets, chainSettings, ensureExtraAddresses, fetchT } from './multichain';
import { assertAllowedX } from './xchains-core';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { readPhrase, wallet } from './wallet';
import { solKey, trxKey } from './multichain-core';
import { SOL_NETS, signSolTransfer, solAddressOk, solDelta, type SolNet, type SolTxRow } from './sol-core';
import { TRON_NETS, parseTronTxs, signTronTransfer, tronAddressOk, type TronNet, type TronTxRow } from './tron-core';

// ---------- Solana ----------

let rid = 0;
async function solRpc<T>(net: SolNet, method: string, params: unknown[]): Promise<T> {
  const r = await fetchT(SOL_NETS[net].rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  if (r.status === 429) throw new Error('The Solana network is busy. Try again in a minute.');
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'The Solana network refused it');
  return j.result as T;
}

export async function solBalance(net: SolNet, address: string): Promise<bigint> {
  const r = await solRpc<{ value: number }>(net, 'getBalance', [address, { commitment: 'confirmed' }]);
  return BigInt(r.value);
}

export async function solHistory(net: SolNet, address: string, limit = 8): Promise<SolTxRow[]> {
  const sigs = await solRpc<{ signature: string; blockTime?: number; err: unknown }[]>(net, 'getSignaturesForAddress', [address, { limit }]);
  const rows = await Promise.all(
    sigs.map(async (s): Promise<SolTxRow | null> => {
      const tx = await solRpc<unknown>(net, 'getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null);
      const d = tx ? solDelta(tx, address) : null;
      return d == null ? null : { id: s.signature, time: s.blockTime ?? undefined, delta: d, failed: s.err != null };
    }),
  );
  return rows.filter((r): r is SolTxRow => r !== null);
}

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** Known token mints, so a balance shows with a name. Others show by their mint. */
export const SOL_TOKENS: Record<string, { symbol: string; name: string; logo?: 'usdc' | 'usdt' }> = {
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': { symbol: 'USDC', name: 'USD Coin', logo: 'usdc' }, // devnet
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin', logo: 'usdc' }, // mainnet
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether', logo: 'usdt' }, // mainnet
};
export interface XToken {
  id: string;
  symbol: string;
  name: string;
  logo?: 'usdc' | 'usdt';
  balance: string;
}
/** Tokens the person added by hand on Solana or Tron: only these (and ones they hold) show in the wallet. */
export interface WatchedX { chain: 'sol' | 'trx'; net: string; id: string; symbol: string; name: string; decimals: number }
export const watchedX = store<WatchedX[]>([]);
export const useWatchedX = () => useStore(watchedX);
export async function loadWatchedX() {
  try { watchedX.set(JSON.parse((await getItem('w.xtokens')) ?? '[]')); } catch {}
}
export async function addWatchedX(t: WatchedX) {
  if (watchedX.get().some((x) => x.chain === t.chain && x.net === t.net && x.id === t.id)) return;
  watchedX.set([...watchedX.get(), t]);
  await setItem('w.xtokens', JSON.stringify(watchedX.get()));
}
export async function removeWatchedX(t: WatchedX) {
  watchedX.set(watchedX.get().filter((x) => !(x.chain === t.chain && x.net === t.net && x.id === t.id)));
  await setItem('w.xtokens', JSON.stringify(watchedX.get()));
}
const mine = (chain: 'sol' | 'trx', net: string) => watchedX.get().filter((w) => w.chain === chain && w.net === net);
const showAmount = (v: bigint, decimals: number) => {
  const unit = 10n ** BigInt(decimals);
  const frac = (v % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${v / unit}${frac ? `.${frac.slice(0, 4)}` : ''}`;
};

/** A Solana token by its mint address: how many decimals it has, and a name if the wallet knows it. */
export async function lookupSolToken(net: SolNet, mint: string): Promise<WatchedX> {
  if (!solAddressOk(mint)) throw new Error('That is not a Solana address.');
  const r = await solRpc<{ value: { data?: { parsed?: { type?: string; info?: { decimals?: number } } } } | null }>(net, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  const info = r.value?.data?.parsed;
  if (!info || info.type !== 'mint' || typeof info.info?.decimals !== 'number') throw new Error('That address is not a token on this network. Check the network and the address.');
  const k = SOL_TOKENS[mint];
  return { chain: 'sol', net, id: mint, symbol: k?.symbol ?? `${mint.slice(0, 4)}…`, name: k?.name ?? `Token ${mint.slice(0, 4)}…${mint.slice(-4)}`, decimals: info.info.decimals };
}

/** A Tron (TRC-20) token by its contract: symbol and decimals are read from the contract. */
export async function lookupTronToken(net: TronNet, contract: string): Promise<WatchedX> {
  if (!tronAddressOk(contract)) throw new Error('That is not a Tron address.');
  const call = async (fn: string) => {
    const j = await tronPost<{ constant_result?: string[] }>(net, '/wallet/triggerconstantcontract', { owner_address: contract, contract_address: contract, function_selector: fn, visible: true });
    const hex = j.constant_result?.[0];
    if (!hex) throw new Error('That address is not a token on this network. Check the network and the address.');
    return hex;
  };
  const [sym, dec] = await Promise.all([call('symbol()'), call('decimals()')]);
  const len = parseInt(sym.slice(64, 128) || '0', 16);
  const symbol = len > 0 && len < 40 ? (sym.slice(128, 128 + len * 2).match(/../g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16))).join('').replace(/[^\x20-\x7e]/g, '') : '';
  const decimals = parseInt(dec.slice(0, 64), 16);
  if (!symbol || !Number.isFinite(decimals) || decimals > 30) throw new Error('That address is not a token on this network. Check the network and the address.');
  return { chain: 'trx', net, id: contract, symbol, name: symbol, decimals };
}

export async function solTokens(net: SolNet, address: string): Promise<XToken[]> {
  const r = await solRpc<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmountString: string; amount: string } } } } } }[] }>(net, 'getTokenAccountsByOwner', [
    address,
    { programId: TOKEN_PROGRAM },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  const held = r.value.map((v) => v.account.data.parsed.info);
  const out: XToken[] = held
    .filter((i) => i.tokenAmount.amount !== '0')
    .map((i) => {
      const w = mine('sol', net).find((x) => x.id === i.mint);
      const k = SOL_TOKENS[i.mint];
      return { id: i.mint, symbol: w?.symbol ?? k?.symbol ?? `${i.mint.slice(0, 4)}…`, name: w?.name ?? k?.name ?? `Token ${i.mint.slice(0, 4)}…${i.mint.slice(-4)}`, logo: k?.logo, balance: i.tokenAmount.uiAmountString };
    });
  for (const w of mine('sol', net)) if (!out.some((o) => o.id === w.id)) out.push({ id: w.id, symbol: w.symbol, name: w.name, logo: SOL_TOKENS[w.id]?.logo, balance: '0' });
  return out;
}

/** Devnet and testnet hand out test SOL themselves (limited per day, and sometimes dry). */
export async function solAirdrop(net: SolNet, address: string): Promise<string> {
  if (SOL_NETS[net].real) throw new Error('No free SOL on mainnet');
  return solRpc<string>(net, 'requestAirdrop', [address, 1_000_000_000]);
}

/** The smallest balance a brand-new Solana account may hold (rent-exempt minimum for an empty account). */
const RENT_MIN = 890_880n;
const SOL_FEE = 5_000n;

export async function prepareSol(to: string, lamports: bigint) {
  const net = activeNets().sol;
  assertAllowedX(chainSettings.get(), 'sol', net);
  const a = await ensureExtraAddresses();
  const from = a.sol!;
  const [bal, toBal, bh] = await Promise.all([solBalance(net, from), solBalance(net, to), solRpc<{ value: { blockhash: string } }>(net, 'getLatestBlockhash', [{ commitment: 'confirmed' }])]);
  if (lamports + SOL_FEE > bal) throw new Error('Not enough SOL for that amount and the network fee (0.000005 SOL).');
  if (toBal === 0n && lamports < RENT_MIN) throw new Error('That address has never held SOL. The first payment to it must be at least 0.00089 SOL.');
  const left = bal - lamports - SOL_FEE;
  if (left > 0n && left < RENT_MIN) throw new Error('That would leave less than 0.00089 SOL, which Solana does not allow. Send everything but 0.001 SOL, or all of it minus the fee.');
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = solKey(phrase, wallet.get().current);
  try {
    if (k.address !== from) throw new Error('Your Solana address does not match your words');
    return { net, from, fee: SOL_FEE, ...signSolTransfer(k.sk, from, to, lamports, bh.value.blockhash) };
  } finally {
    k.sk.fill(0);
  }
}

export async function broadcastSol(net: SolNet, b64: string): Promise<string> {
  return solRpc<string>(net, 'sendTransaction', [b64, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
}

/** The slot once the payment is confirmed, null while waiting. Throws if it failed. */
export async function solTxSlot(net: SolNet, id: string): Promise<number | null> {
  const r = await solRpc<{ value: ({ slot: number; err: unknown; confirmationStatus?: string } | null)[] }>(net, 'getSignatureStatuses', [[id], { searchTransactionHistory: true }]);
  const s = r.value[0];
  if (!s) return null;
  if (s.err) throw new Error('The payment failed on the network. Only the fee was spent.');
  return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? s.slot : null;
}

// ---------- Tron ----------

async function tronPost<T>(net: TronNet, path: string, body: unknown): Promise<T> {
  const r = await fetchT(`${TRON_NETS[net].api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 429) throw new Error('The Tron network is busy. Try again in a minute.');
  if (!r.ok) throw new Error(`The Tron network answered ${r.status}`);
  return (await r.json()) as T;
}
async function tronGet<T>(net: TronNet, path: string): Promise<T> {
  const r = await fetchT(`${TRON_NETS[net].api}${path}`);
  if (r.status === 429) throw new Error('The Tron network is busy. Try again in a minute.');
  if (!r.ok) throw new Error(`The Tron network answered ${r.status}`);
  return (await r.json()) as T;
}

/** A Tron address that has never received anything does not exist yet; its balance is 0. */
export async function trxBalance(net: TronNet, address: string): Promise<bigint> {
  const r = await tronPost<{ balance?: number }>(net, '/wallet/getaccount', { address, visible: true });
  return BigInt(r.balance ?? 0);
}

export async function tronHistory(net: TronNet, address: string): Promise<TronTxRow[]> {
  return parseTronTxs(await tronGet<unknown>(net, `/v1/accounts/${address}/transactions?limit=20`), address).slice(0, 10);
}

/** TRC-20 tokens with a known name and decimals. */
export const TRON_TOKENS: Partial<Record<TronNet, Record<string, { symbol: string; name: string; decimals: number; logo?: 'usdt' | 'usdc' }>>> = {
  nile: { TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf: { symbol: 'USDT', name: 'Tether', decimals: 6, logo: 'usdt' } },
  mainnet: { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { symbol: 'USDT', name: 'Tether', decimals: 6, logo: 'usdt' } },
};
export async function tronTokens(net: TronNet, address: string): Promise<XToken[]> {
  const j = await tronGet<{ data?: { trc20?: Record<string, string>[] }[] }>(net, `/v1/accounts/${address}`);
  const list = j.data?.[0]?.trc20 ?? [];
  const known: Record<string, { symbol: string; name: string; decimals: number; logo?: 'usdt' | 'usdc' }> = { ...(TRON_TOKENS[net] ?? {}) };
  for (const w of mine('trx', net)) known[w.id] ??= { symbol: w.symbol, name: w.name, decimals: w.decimals };
  const out: XToken[] = [];
  for (const entry of list)
    for (const [contract, raw] of Object.entries(entry)) {
      const k = known[contract];
      if (!k || !/^\d+$/.test(raw) || raw === '0') continue;
      out.push({ id: contract, symbol: k.symbol, name: k.name, logo: k.logo, balance: showAmount(BigInt(raw), k.decimals) });
    }
  for (const w of mine('trx', net)) if (!out.some((o) => o.id === w.id)) out.push({ id: w.id, symbol: w.symbol, name: w.name, balance: '0' });
  return out;
}

export async function prepareTron(to: string, sun: bigint) {
  const net = activeNets().trx;
  assertAllowedX(chainSettings.get(), 'trx', net);
  if (!tronAddressOk(to)) throw new Error('That is not a Tron address');
  const a = await ensureExtraAddresses();
  const from = a.trx!;
  const [bal, toAcct, block] = await Promise.all([
    trxBalance(net, from),
    tronPost<{ address?: string }>(net, '/wallet/getaccount', { address: to, visible: true }),
    tronPost<{ blockID: string; block_header: { raw_data: { number: number; timestamp: number } } }>(net, '/wallet/getnowblock', {}),
  ]);
  // a new address costs 1 TRX to create; a payment without free bandwidth burns a little TRX for it
  const newAccount = !toAcct.address;
  const reserve = newAccount ? 1_100_000n : 300_000n;
  if (sun + reserve > bal) throw new Error(newAccount ? 'Not enough TRX. Paying a new Tron address costs 1 TRX extra to create it, plus a small fee.' : 'Not enough TRX for that amount and the network fee (keep about 0.3 TRX).');
  const ref = { number: block.block_header.raw_data.number, id: block.blockID, timestamp: block.block_header.raw_data.timestamp };
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = trxKey(phrase, 0, wallet.get().current);
  try {
    if (k.address !== from) throw new Error('Your Tron address does not match your words');
    return { net, from, newAccount, ...signTronTransfer(k.sk, from, to, sun, ref, Date.now()) };
  } finally {
    k.sk.fill(0);
  }
}

const unhex = (h: string) => {
  try {
    return decodeURIComponent(h.replace(/(..)/g, '%$1'));
  } catch {
    return h;
  }
};
export async function broadcastTron(net: TronNet, hex: string): Promise<string> {
  const r = await tronPost<{ result?: boolean; txid?: string; code?: string; message?: string }>(net, '/wallet/broadcasthex', { transaction: hex });
  if (!r.result) throw new Error(`The Tron network refused it: ${r.message ? unhex(r.message) : r.code ?? 'no reason given'}`);
  return r.txid ?? '';
}

/** The block once the payment is in one, null while waiting. Throws if it failed. */
export async function tronTxBlock(net: TronNet, id: string): Promise<number | null> {
  const r = await tronPost<{ blockNumber?: number; result?: string; resMessage?: string }>(net, '/wallet/gettransactioninfobyid', { value: id });
  if (r.result === 'FAILED') throw new Error(`The payment failed: ${r.resMessage ? unhex(r.resMessage) : 'no reason given'}`);
  return r.blockNumber ?? null;
}
