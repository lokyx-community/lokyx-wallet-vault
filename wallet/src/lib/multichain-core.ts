// Bitcoin and Ethereum from the same 24 words. Pure functions (no network, no phone APIs), tested in
// test/multichain.test.ts against the published BIP test vectors.
//
//   Bitcoin  BIP84 native segwit  m/84'/<0 mainnet | 1 test>'/0'/0/i      (bc1q… / tb1q…)
//   Ethereum                      m/44'/60'/0'/0/i
//
// Real-money networks (Bitcoin mainnet, Ethereum mainnet) are off unless the person turns on the
// setting; by default only test networks work.

import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { encodeFunctionData, getAddress, isAddress as isEthAddress, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SOL_NETS, solKeyFromSeed, type SolNet } from './sol-core.ts';
import { TRON_NETS, tronKey, type TronNet } from './tron-core.ts';

export type ExtraChain = 'sol' | 'trx';

/** Ethereum-style chains that can be added to Home as their own card. They share the Ethereum address. */
export type EvmFamily = 'base' | 'arbitrum' | 'optimism' | 'polygon' | 'bnb' | 'avalanche';
export const EVM_FAMILIES: Record<EvmFamily, { name: string; logo: 'base' | 'arb' | 'op' | 'pol' | 'bnb' | 'avax'; unit: string; test: EthNet; main: EthNet }> = {
  base: { name: 'Base', logo: 'base', unit: 'ETH', test: 'base-sepolia', main: 'base' },
  arbitrum: { name: 'Arbitrum', logo: 'arb', unit: 'ETH', test: 'arbitrum-sepolia', main: 'arbitrum' },
  optimism: { name: 'Optimism', logo: 'op', unit: 'ETH', test: 'op-sepolia', main: 'optimism' },
  polygon: { name: 'Polygon', logo: 'pol', unit: 'POL', test: 'polygon-amoy', main: 'polygon' },
  bnb: { name: 'BNB Chain', logo: 'bnb', unit: 'BNB', test: 'bnb-testnet', main: 'bnb' },
  avalanche: { name: 'Avalanche', logo: 'avax', unit: 'AVAX', test: 'avalanche-fuji', main: 'avalanche' },
};
export const EVM_ORDER = Object.keys(EVM_FAMILIES) as EvmFamily[];
/** The network a chain's card follows: its real one only when real-money networks are allowed. */
export const evmNet = (f: EvmFamily, allowMainnet: boolean): EthNet => (allowMainnet ? EVM_FAMILIES[f].main : EVM_FAMILIES[f].test);
/** Which added chain a network belongs to, if any (Ethereum itself belongs to none). */
export const evmOf = (n: EthNet): EvmFamily | null => EVM_ORDER.find((f) => EVM_FAMILIES[f].test === n || EVM_FAMILIES[f].main === n) ?? null;

// ---------- networks ----------

export type BtcNet = 'signet' | 'testnet4' | 'testnet' | 'mainnet';
export type EthNet =
  | 'sepolia' | 'base-sepolia' | 'arbitrum-sepolia' | 'op-sepolia' | 'polygon-amoy' | 'bnb-testnet' | 'avalanche-fuji' | 'linea-sepolia' | 'scroll-sepolia' | 'mantle-sepolia'
  | 'mainnet' | 'base' | 'arbitrum' | 'optimism' | 'polygon' | 'bnb' | 'avalanche' | 'linea' | 'scroll' | 'gnosis' | 'celo';

export const BTC_NETS: Record<BtcNet, { label: string; unit: string; coinType: number; net: typeof btc.NETWORK; real: boolean; esplora: string }> = {
  signet: { label: 'Bitcoin signet', unit: 'sBTC', coinType: 1, net: btc.TEST_NETWORK, real: false, esplora: 'https://mempool.space/signet/api' },
  testnet4: { label: 'Bitcoin testnet4', unit: 'tBTC', coinType: 1, net: btc.TEST_NETWORK, real: false, esplora: 'https://mempool.space/testnet4/api' },
  testnet: { label: 'Bitcoin testnet', unit: 'tBTC', coinType: 1, net: btc.TEST_NETWORK, real: false, esplora: 'https://blockstream.info/testnet/api' },
  mainnet: { label: 'Bitcoin', unit: 'BTC', coinType: 0, net: btc.NETWORK, real: true, esplora: 'https://blockstream.info/api' },
};

export const ETH_NETS: Record<EthNet, { label: string; short: string; unit: string; chainId: number; real: boolean; rpc: string; explorer: string }> = {
  sepolia: { label: 'Ethereum Sepolia', short: 'Sepolia', unit: 'SepoliaETH', chainId: 11155111, real: false, rpc: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io' },
  'base-sepolia': { label: 'Base Sepolia', short: 'Base', unit: 'ETH', chainId: 84532, real: false, rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org' },
  'arbitrum-sepolia': { label: 'Arbitrum Sepolia', short: 'Arbitrum', unit: 'ETH', chainId: 421614, real: false, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io' },
  'op-sepolia': { label: 'Optimism Sepolia', short: 'Optimism', unit: 'ETH', chainId: 11155420, real: false, rpc: 'https://sepolia.optimism.io', explorer: 'https://sepolia-optimism.etherscan.io' },
  'polygon-amoy': { label: 'Polygon Amoy', short: 'Polygon', unit: 'POL', chainId: 80002, real: false, rpc: 'https://rpc-amoy.polygon.technology', explorer: 'https://amoy.polygonscan.com' },
  'bnb-testnet': { label: 'BNB Chain testnet', short: 'BNB', unit: 'tBNB', chainId: 97, real: false, rpc: 'https://bsc-testnet-rpc.publicnode.com', explorer: 'https://testnet.bscscan.com' },
  'avalanche-fuji': { label: 'Avalanche Fuji', short: 'Avalanche', unit: 'AVAX', chainId: 43113, real: false, rpc: 'https://api.avax-test.network/ext/bc/C/rpc', explorer: 'https://testnet.snowtrace.io' },
  'linea-sepolia': { label: 'Linea Sepolia', short: 'Linea', unit: 'ETH', chainId: 59141, real: false, rpc: 'https://rpc.sepolia.linea.build', explorer: 'https://sepolia.lineascan.build' },
  'scroll-sepolia': { label: 'Scroll Sepolia', short: 'Scroll', unit: 'ETH', chainId: 534351, real: false, rpc: 'https://sepolia-rpc.scroll.io', explorer: 'https://sepolia.scrollscan.com' },
  'mantle-sepolia': { label: 'Mantle Sepolia', short: 'Mantle', unit: 'MNT', chainId: 5003, real: false, rpc: 'https://rpc.sepolia.mantle.xyz', explorer: 'https://sepolia.mantlescan.xyz' },
  mainnet: { label: 'Ethereum', short: 'Mainnet', unit: 'ETH', chainId: 1, real: true, rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
  base: { label: 'Base', short: 'Base', unit: 'ETH', chainId: 8453, real: true, rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org' },
  arbitrum: { label: 'Arbitrum One', short: 'Arbitrum', unit: 'ETH', chainId: 42161, real: true, rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io' },
  optimism: { label: 'Optimism', short: 'Optimism', unit: 'ETH', chainId: 10, real: true, rpc: 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io' },
  polygon: { label: 'Polygon', short: 'Polygon', unit: 'POL', chainId: 137, real: true, rpc: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com' },
  bnb: { label: 'BNB Chain', short: 'BNB', unit: 'BNB', chainId: 56, real: true, rpc: 'https://bsc-rpc.publicnode.com', explorer: 'https://bscscan.com' },
  avalanche: { label: 'Avalanche C-Chain', short: 'Avalanche', unit: 'AVAX', chainId: 43114, real: true, rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' },
  linea: { label: 'Linea', short: 'Linea', unit: 'ETH', chainId: 59144, real: true, rpc: 'https://rpc.linea.build', explorer: 'https://lineascan.build' },
  scroll: { label: 'Scroll', short: 'Scroll', unit: 'ETH', chainId: 534352, real: true, rpc: 'https://rpc.scroll.io', explorer: 'https://scrollscan.com' },
  gnosis: { label: 'Gnosis', short: 'Gnosis', unit: 'xDAI', chainId: 100, real: true, rpc: 'https://rpc.gnosischain.com', explorer: 'https://gnosisscan.io' },
  celo: { label: 'Celo', short: 'Celo', unit: 'CELO', chainId: 42220, real: true, rpc: 'https://forno.celo.org', explorer: 'https://celoscan.io' },
};
/** The networks that take the same Ethereum address, in the order they are offered. Real money only when allowed. */
export const ethNetChoices = (allowMainnet: boolean): EthNet[] => (Object.keys(ETH_NETS) as EthNet[]).filter((n) => allowMainnet || !ETH_NETS[n].real);

export interface ChainSettings {
  /** Off by default. Real money. Turned on only in Settings. */
  allowMainnet: boolean;
  btcNet: BtcNet;
  ethNet: EthNet;
  esplora: Partial<Record<BtcNet, string>>;
  ethRpc: Partial<Record<EthNet, string>>;
  solNet: SolNet;
  tronNet: TronNet;
  /** the blockchains added with the + on Home, beyond LOKYX, Bitcoin and Ethereum */
  extra: ExtraChain[];
  /** Base, Arbitrum and the other Ethereum-style chains added with the + on Home */
  evm: EvmFamily[];
}

export const DEFAULT_CHAIN_SETTINGS: ChainSettings = { allowMainnet: false, btcNet: 'signet', ethNet: 'sepolia', esplora: {}, ethRpc: {}, solNet: 'devnet', tronNet: 'nile', extra: ['sol', 'trx'], evm: [] };

/** The networks in effect: a real-money one is ignored unless mainnet is allowed. */
export function effective(s: ChainSettings): { btc: BtcNet; eth: EthNet; sol: SolNet; trx: TronNet } {
  return {
    sol: SOL_NETS[s.solNet]?.real && !s.allowMainnet ? 'devnet' : (s.solNet ?? 'devnet'),
    trx: TRON_NETS[s.tronNet]?.real && !s.allowMainnet ? 'nile' : (s.tronNet ?? 'nile'),
    btc: BTC_NETS[s.btcNet].real && !s.allowMainnet ? 'signet' : s.btcNet,
    eth: ETH_NETS[s.ethNet].real && !s.allowMainnet ? 'sepolia' : s.ethNet,
  };
}

/** True when every coin is pointed at its real-money network. */
export const isRealMode = (s: ChainSettings): boolean => s.allowMainnet && !!BTC_NETS[s.btcNet]?.real && !!ETH_NETS[s.ethNet]?.real && s.solNet === 'mainnet' && s.tronNet === 'mainnet';

/** The settings that move Bitcoin, Ethereum, Solana and Tron together: all to real money, or all back to the test networks. */
export const modeSettings = (real: boolean): Pick<ChainSettings, 'allowMainnet' | 'btcNet' | 'ethNet' | 'solNet' | 'tronNet'> =>
  real ? { allowMainnet: true, btcNet: 'mainnet', ethNet: 'mainnet', solNet: 'mainnet', tronNet: 'mainnet' } : { allowMainnet: false, btcNet: 'signet', ethNet: 'sepolia', solNet: 'devnet', tronNet: 'nile' };

/** Throws if a send would touch real money while that setting is off. A last guard in front of signing. */
export function assertAllowed(s: ChainSettings, chain: 'btc' | 'eth', net: BtcNet | EthNet) {
  const real = chain === 'btc' ? BTC_NETS[net as BtcNet].real : ETH_NETS[net as EthNet].real;
  if (real && !s.allowMainnet) throw new Error('Real-money networks are turned off. This beta only sends on test networks.');
}

// ---------- keys ----------

/** `acct` is the wallet account (BIP44 account level). Account 0 is the original wallet, so nothing it had changes. */
export const btcPath = (net: BtcNet, i: number, acct = 0) => `m/84'/${BTC_NETS[net].coinType}'/${acct}'/0/${i}`;
export const ethPath = (i: number, acct = 0) => `m/44'/60'/${acct}'/0/${i}`;

const root = (phrase: string) => HDKey.fromMasterSeed(mnemonicToSeedSync(phrase.trim().toLowerCase().split(/\s+/).join(' ')));

export function btcKey(phrase: string, net: BtcNet, i = 0, acct = 0) {
  const k = root(phrase).derive(btcPath(net, i, acct));
  if (!k.privateKey || !k.publicKey) throw new Error('Key derivation failed');
  return { sk: k.privateKey, address: btc.p2wpkh(k.publicKey, BTC_NETS[net].net).address! };
}

/** Every public address at once, from one seed: the slow part (turning words into a seed) runs once, not once per chain. */
export function allAddresses(phrase: string, acct = 0): { btc: Record<BtcNet, string>; eth: string; sol: string; trx: string } {
  const seed = mnemonicToSeedSync(phrase.trim().toLowerCase().split(/\s+/).join(' '));
  const r = HDKey.fromMasterSeed(seed);
  const b = (net: BtcNet) => {
    const k = r.derive(btcPath(net, 0, acct));
    if (!k.publicKey) throw new Error('Key derivation failed');
    return btc.p2wpkh(k.publicKey, BTC_NETS[net].net).address!;
  };
  const e = r.derive(ethPath(0, acct));
  if (!e.privateKey) throw new Error('Key derivation failed');
  const eth = privateKeyToAccount(`0x${bytesToHex(e.privateKey)}`).address;
  e.privateKey.fill(0);
  const s = solKeyFromSeed(seed, acct);
  s.sk.fill(0);
  const t = tronKey(r, 0, acct);
  t.sk.fill(0);
  seed.fill(0);
  return { btc: { signet: b('signet'), testnet4: b('testnet4'), testnet: b('testnet'), mainnet: b('mainnet') }, eth, sol: s.address, trx: t.address };
}

/** The Solana key, for signing one payment. Wipe `sk` after. */
export function solKey(phrase: string, i = 0) {
  const seed = mnemonicToSeedSync(phrase.trim().toLowerCase().split(/\s+/).join(' '));
  try {
    return solKeyFromSeed(seed, i);
  } finally {
    seed.fill(0);
  }
}
/** The Tron key, for signing one payment. Wipe `sk` after. */
export const trxKey = (phrase: string, i = 0, acct = 0) => tronKey(root(phrase), i, acct);

export function ethKey(phrase: string, i = 0, acct = 0) {
  const k = root(phrase).derive(ethPath(i, acct));
  if (!k.privateKey) throw new Error('Key derivation failed');
  return { sk: k.privateKey, address: privateKeyToAccount(`0x${bytesToHex(k.privateKey)}`).address };
}

// ---------- address checks ----------

export function btcAddressOk(addr: string, net: BtcNet): boolean {
  try {
    const o = btc.Address(BTC_NETS[net].net).decode(addr.trim());
    return !!o;
  } catch {
    return false;
  }
}

/** A mixed-case Ethereum address must have the right checksum; all-lowercase is accepted. */
export function ethAddressOk(addr: string): boolean {
  const a = addr.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  return isEthAddress(a, { strict: a !== a.toLowerCase() && a !== '0x' + a.slice(2).toUpperCase() });
}
export const ethChecksum = (a: string) => getAddress(a.trim());

// ---------- address poisoning ----------

const norm = (a: string) => a.trim().toLowerCase();

/**
 * A "poisoned" address copies the first and last characters of one you use, hoping you'll compare only
 * those. Returns the known address it imitates, or null. An exact match is never a warning.
 */
export function lookalike(dest: string, known: string[], head = 4, tail = 4): string | null {
  const d = norm(dest);
  if (known.some((k) => norm(k) === d)) return null;
  for (const k of known) {
    const n = norm(k);
    if (n.length !== d.length || n.length < head + tail + 2) continue;
    // ignore the fixed prefix (0x, bc1q, tb1q, lyx1) when comparing the visible start
    const pre = n.startsWith('0x') ? 2 : n.startsWith('bc1') || n.startsWith('tb1') ? 4 : n.startsWith('lyx1') ? 4 : 0;
    if (n.slice(pre, pre + head) === d.slice(pre, pre + head) && n.slice(-tail) === d.slice(-tail)) return k;
  }
  return null;
}

// ---------- Bitcoin: amounts, fees, coin selection, signing ----------

export const SAT = 100_000_000n;
export function formatBtc(sats: bigint): string {
  const w = sats / SAT;
  const f = (sats % SAT).toString().padStart(8, '0').replace(/0+$/, '');
  return f ? `${w}.${f}` : `${w}`;
}
export function parseBtc(s: string): bigint {
  const t = s.trim();
  if (!/^\d*(\.\d{0,8})?$/.test(t) || t === '' || t === '.') throw new Error('Enter an amount like 0.001 (at most 8 decimals)');
  const [w, f = ''] = t.split('.');
  return BigInt(w || '0') * SAT + BigInt((f + '00000000').slice(0, 8));
}

export type Speed = 'slow' | 'normal' | 'fast';
/** sat/vB for each speed from Esplora's /fee-estimates ({ "1": 20.5, "3": 12, … }). */
export function pickFeeRates(est: Record<string, number>): Record<Speed, number> {
  const at = (target: number) => {
    const keys = Object.keys(est).map(Number).filter((k) => k > 0).sort((a, b) => a - b);
    const k = keys.find((x) => x >= target) ?? keys[keys.length - 1];
    return k != null ? est[String(k)] : 1;
  };
  const r = (n: number) => Math.max(1, Math.ceil(n));
  return { fast: r(at(1)), normal: r(at(3)), slow: r(at(12)) };
}

export interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
}

const DUST = 294n; // P2WPKH dust limit in sats

// P2WPKH virtual sizes: 10.5 overhead, 68 per input, 31 per output.
const vsize = (ins: number, outs: number) => Math.ceil(10.5 + 68 * ins + 31 * outs);

/** The most Bitcoin that can be sent from these coins at `rate`: everything, minus the fee for a payment with no change. 0 if nothing is left. */
export function maxBtc(utxos: Utxo[], rate: number): bigint {
  const sum = utxos.reduce((a, u) => a + u.value, 0n);
  const fee = BigInt(Math.ceil(vsize(utxos.length, 1) * rate));
  return sum - fee >= DUST ? sum - fee : 0n;
}

/** The most of the native coin that can be sent on an Ethereum-style chain: the balance minus the most a plain transfer can cost. */
export function maxEth(balance: bigint, maxFeePerGas: bigint, gas = 21_000n): bigint {
  const fee = gas * maxFeePerGas;
  return balance > fee ? balance - fee : 0n;
}

export interface Plan {
  inputs: Utxo[];
  amount: bigint;
  fee: bigint;
  change: bigint;
  vbytes: number;
}

/** Pick inputs (largest first), compute the fee at `rate` sat/vB, keep change unless it would be dust. */
export function planBtc(utxos: Utxo[], amount: bigint, rate: number): Plan {
  if (amount < DUST) throw new Error('That amount is below the minimum Bitcoin will relay (about 294 sats).');
  const sorted = [...utxos].sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));
  const chosen: Utxo[] = [];
  let sum = 0n;
  for (const u of sorted) {
    chosen.push(u);
    sum += u.value;
    const withChange = BigInt(Math.ceil(vsize(chosen.length, 2) * rate));
    const noChange = BigInt(Math.ceil(vsize(chosen.length, 1) * rate));
    if (sum >= amount + withChange) {
      const change = sum - amount - withChange;
      if (change >= DUST) return { inputs: chosen, amount, fee: withChange, change, vbytes: vsize(chosen.length, 2) };
    }
    if (sum >= amount + noChange) {
      // change would be dust (or nothing): it goes to the miners as extra fee
      return { inputs: chosen, amount, fee: sum - amount, change: 0n, vbytes: vsize(chosen.length, 1) };
    }
  }
  throw new Error("You don't have enough for that amount and the network fee.");
}

export interface SignedBtc {
  hex: string;
  txid: string;
  plan: Plan;
  vbytes: number;
}

export function signBtc(p: { sk: Uint8Array; from: string; to: string; net: BtcNet; utxos: Utxo[]; amount: bigint; rate: number }): SignedBtc {
  const n = BTC_NETS[p.net].net;
  if (!btcAddressOk(p.to, p.net)) throw new Error(`That is not a valid ${BTC_NETS[p.net].label} address.`);
  const plan = planBtc(p.utxos, p.amount, p.rate);
  const spend = btc.p2wpkh(secpPub(p.sk), n);
  if (spend.address !== p.from) throw new Error('The key does not match the sending address.');
  const tx = new btc.Transaction();
  for (const u of plan.inputs) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: spend.script, amount: u.value } });
  tx.addOutputAddress(p.to.trim(), plan.amount, n);
  if (plan.change > 0n) tx.addOutputAddress(p.from, plan.change, n);
  tx.sign(p.sk);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, plan, vbytes: tx.vsize };
}

import { secp256k1 } from '@noble/curves/secp256k1.js';
const secpPub = (sk: Uint8Array) => secp256k1.getPublicKey(sk, true);

// ---------- Ethereum: EIP-1559 transfers and ERC-20 ----------

export const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

/** A token is its contract address on a chain. The symbol is only a label the person can see. */
export interface EthToken {
  chainId: number;
  contract: string;
  symbol: string;
  decimals: number;
  /** the issuer's name for it, only on tokens from the list below (a token's own name can be anything) */
  name?: string;
}

/**
 * The token list: contracts the app knows to be the real ones. Searching by name only finds these, and a
 * pasted contract that copies one of their symbols is stopped. Nothing here is in the wallet until added.
 */
export const KNOWN_TOKENS: EthToken[] = [
  { chainId: 11155111, contract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', decimals: 6, name: 'USD Coin (test)' },
  { chainId: 84532, contract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', symbol: 'USDC', decimals: 6, name: 'USD Coin (test)' },
  { chainId: 421614, contract: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', symbol: 'USDC', decimals: 6, name: 'USD Coin (test)' },
  { chainId: 1, contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6, name: 'Tether' },
  { chainId: 1, contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  { chainId: 1, contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18, name: 'Dai' },
  { chainId: 1, contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8, name: 'Wrapped Bitcoin' },
  { chainId: 1, contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18, name: 'Chainlink' },
  // Solana's coin as an Ethereum token: Wormhole's wrapped SOL (9 decimals), minted against SOL locked on Solana.
  { chainId: 1, contract: '0xD31a59c85aE9D8edEFeC411D448f90841571b89c', symbol: 'SOL', decimals: 9, name: 'Wrapped SOL (Wormhole)' },
  { chainId: 8453, contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  { chainId: 42161, contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  { chainId: 10, contract: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  { chainId: 137, contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  // BNB Chain's test dollar tokens have 18 decimals, not 6. Real-money USDT on Arbitrum, Optimism, Polygon and BNB, and USDC on BNB, are not here until their addresses are checked.
  { chainId: 97, contract: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd', symbol: 'USDT', decimals: 18, name: 'Tether (test)' },
  { chainId: 97, contract: '0x64544969ed7EBf5f083679233325356EbE738930', symbol: 'USDC', decimals: 18, name: 'USD Coin (test)' },
  { chainId: 11155420, contract: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', symbol: 'USDC', decimals: 6, name: 'USD Coin (test)' },
];

/** The coins every wallet offers on a network without anyone pasting an address: the list above, for that chain. */
export const presetsFor = (chainId: number): EthToken[] => KNOWN_TOKENS.filter((k) => k.chainId === chainId);

/** Tokens on the list that match what someone typed: a symbol or a name, from the start of a word. */
export function searchKnown(chainId: number, q: string): EthToken[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return KNOWN_TOKENS.filter((k) => k.chainId === chainId).filter((k) => k.symbol.toLowerCase().startsWith(t) || (k.name ?? '').toLowerCase().split(/\s+/).some((w) => w.startsWith(t)) || (k.name ?? '').toLowerCase().startsWith(t));
}

export const tokenId = (t: { chainId: number; contract: string }) => `${t.chainId}:${t.contract.toLowerCase()}`;

export function formatUnits(v: bigint, decimals: number, maxFrac = decimals): string {
  const base = 10n ** BigInt(decimals);
  const f = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return f ? `${v / base}.${f}` : `${v / base}`;
}
export function parseUnits(s: string, decimals: number): bigint {
  const t = s.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') throw new Error('Enter an amount like 1.25');
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** Three speeds from the node's base fee and a suggested tip. */
export function ethFeeChoices(baseFee: bigint, tip: bigint): Record<Speed, Fees> {
  const mk = (tipMul: bigint, baseMul: bigint): Fees => ({ maxPriorityFeePerGas: (tip * tipMul) / 100n, maxFeePerGas: (baseFee * baseMul) / 100n + (tip * tipMul) / 100n });
  return { slow: mk(80n, 120n), normal: mk(100n, 200n), fast: mk(150n, 250n) };
}

export interface EthSend {
  net: EthNet;
  sk: Uint8Array;
  nonce: number;
  to: string;
  /** wei for ETH; token base units when `token` is set. */
  amount: bigint;
  token?: EthToken;
  gas: bigint;
  fees: Fees;
}

/** Sign an EIP-1559 transaction offline. */
export async function signEth(p: EthSend): Promise<{ raw: Hex; to: string; data: Hex; value: bigint }> {
  const chainId = ETH_NETS[p.net].chainId;
  if (p.token && p.token.chainId !== chainId) throw new Error('That token is on a different network.');
  if (!ethAddressOk(p.to)) throw new Error('That is not a valid Ethereum address (or its capitals are wrong).');
  const account = privateKeyToAccount(`0x${bytesToHex(p.sk)}`);
  const to = (p.token ? p.token.contract : p.to) as Hex;
  const data = p.token ? encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [ethChecksum(p.to) as Hex, p.amount] }) : ('0x' as Hex);
  const value = p.token ? 0n : p.amount;
  const raw = await account.signTransaction({ type: 'eip1559', chainId, nonce: p.nonce, to, value, data, gas: p.gas, maxFeePerGas: p.fees.maxFeePerGas, maxPriorityFeePerGas: p.fees.maxPriorityFeePerGas });
  return { raw, to, data, value };
}

// ---------- clear signing ----------

const gwei = (w: bigint) => `${formatUnits(w, 9, 3)} gwei`;

export function describeBtc(p: { plan: Plan; to: string; from: string; net: BtcNet; rate: number }): string[] {
  const u = BTC_NETS[p.net].unit;
  const lines = [
    `Send ${formatBtc(p.plan.amount)} ${u} to ${p.to}.`,
    `Network fee: ${formatBtc(p.plan.fee)} ${u} (${p.rate} sat/vB, about ${p.plan.vbytes} vbytes).`,
    `Total leaving your wallet: ${formatBtc(p.plan.amount + p.plan.fee)} ${u}.`,
  ];
  if (p.plan.change > 0n) lines.push(`${formatBtc(p.plan.change)} ${u} comes back to your address ${p.from}.`);
  if (BTC_NETS[p.net].real === false) lines.push('This is a test network: these coins have no value.');
  return lines;
}

export function describeEth(p: { net: EthNet; to: string; amount: bigint; token?: EthToken; gas: bigint; fees: Fees }): string[] {
  const n = ETH_NETS[p.net];
  const maxFee = p.gas * p.fees.maxFeePerGas;
  const head = p.token
    ? [`Send ${formatUnits(p.amount, p.token.decimals)} ${p.token.symbol} to ${p.to}.`, `Token contract: ${p.token.contract} (this is what identifies the token, not its name).`]
    : [`Send ${formatUnits(p.amount, 18)} ${n.unit} to ${p.to}.`];
  const out = [...head, `Network fee: up to ${formatUnits(maxFee, 18, 8)} ${n.unit} (max ${gwei(p.fees.maxFeePerGas)}, tip ${gwei(p.fees.maxPriorityFeePerGas)}).`];
  if (!n.real) out.push('This is a test network: these coins have no value.');
  return out;
}

export { hexToBytes };

// ---------- Ethereum history (Blockscout, no key needed) ----------

export const BLOCKSCOUT: Partial<Record<EthNet, string>> = {
  sepolia: 'https://eth-sepolia.blockscout.com',
  'base-sepolia': 'https://base-sepolia.blockscout.com',
  'arbitrum-sepolia': 'https://arbitrum-sepolia.blockscout.com',
  'op-sepolia': 'https://optimism-sepolia.blockscout.com',
  mainnet: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  optimism: 'https://optimism.blockscout.com',
  polygon: 'https://polygon.blockscout.com',
  gnosis: 'https://gnosis.blockscout.com',
  celo: 'https://celo.blockscout.com',
};

export interface EthTxRow {
  hash: string;
  /** positive = received, negative = sent; in the coin's smallest unit */
  delta: bigint;
  decimals: number;
  symbol: string;
  failed: boolean;
  /** unix seconds, 0 if unknown */
  time: number;
  /** the address on the other side (lower case), when there is one */
  other?: string;
}

type Hash = { hash?: string } | null | undefined;
const lower = (x: Hash) => (x?.hash ?? '').toLowerCase();
const secs = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};
const big = (v: unknown) => {
  try {
    return BigInt(String(v ?? '0'));
  } catch {
    return 0n;
  }
};

/** Blockscout's coin transfers for one address. Calls that move no coin (token moves, approvals) are left out. */
export function parseEthTxs(json: unknown, me: string, symbol: string): EthTxRow[] {
  const items = (json as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const m = me.toLowerCase();
  const out: EthTxRow[] = [];
  for (const raw of items) {
    const t = raw as { hash?: string; from?: Hash; to?: Hash; value?: string; status?: string; result?: string; timestamp?: string };
    const v = big(t.value);
    if (!t.hash || v === 0n) continue;
    const sent = lower(t.from) === m;
    const got = lower(t.to) === m;
    if (!sent && !got) continue;
    out.push({ hash: t.hash, delta: sent && !got ? -v : sent && got ? 0n : v, decimals: 18, symbol, failed: t.status === 'error' || (!!t.result && t.result !== 'success'), time: secs(t.timestamp), other: sent ? lower(t.to) : lower(t.from) || undefined });
  }
  return out;
}

/** Blockscout's token transfers for one address. */
export function parseTokenTxs(json: unknown, me: string): EthTxRow[] {
  const items = (json as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const m = me.toLowerCase();
  const out: EthTxRow[] = [];
  for (const raw of items) {
    const t = raw as { transaction_hash?: string; tx_hash?: string; from?: Hash; to?: Hash; total?: { value?: string; decimals?: string | null }; token?: { symbol?: string; decimals?: string | null }; timestamp?: string };
    const hash = t.transaction_hash ?? t.tx_hash;
    const v = big(t.total?.value);
    if (!hash || v === 0n) continue;
    const sent = lower(t.from) === m;
    const got = lower(t.to) === m;
    if (!sent && !got) continue;
    const d = Number(t.total?.decimals ?? t.token?.decimals ?? 18);
    out.push({ hash, delta: sent && !got ? -v : sent && got ? 0n : v, decimals: Number.isFinite(d) ? d : 18, symbol: t.token?.symbol ?? '', failed: false, time: secs(t.timestamp) });
  }
  return out;
}
