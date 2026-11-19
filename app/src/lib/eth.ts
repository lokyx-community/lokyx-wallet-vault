// Ethereum side of a swap: the LokyxSwap contract (contracts/LokyxSwap.sol) on an EVM chain.
// Reads go to a public RPC; writes go through MetaMask (window.ethereum).
//
// A lock's id is keccak256(abi.encode(sender, recipient, hashlock, refundTime, amount)), so both
// sides can work it out in advance, and a lock found at that id matches the deal by construction.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { SWAP_RUNTIME, SWAP_BYTECODE } from './swapContract';

export interface EvmNet {
  chainId: number;
  name: string;
  rpc: string;
  /** LokyxSwap deployment on this chain, if known. */
  contract: string;
  explorer?: string;
  symbol: string;
}

export const EVM_NETS: EvmNet[] = [
  { chainId: 11155111, name: 'Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', contract: '', explorer: 'https://sepolia.etherscan.io', symbol: 'ETH' },
  { chainId: 31337, name: 'Local (Hardhat)', rpc: 'http://127.0.0.1:8545', contract: '', symbol: 'ETH' },
];

export const isEthAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

// ---------- ABI encoding (static types only, which is all the contract uses) ----------

const sel = (sig: string) => keccak_256(utf8ToBytes(sig)).slice(0, 4);
const word = (b: Uint8Array) => {
  const w = new Uint8Array(32);
  w.set(b, 32 - b.length);
  return w;
};
const uint = (v: bigint) => word(hexToBytes(v.toString(16).padStart(64, '0')));
const addr = (a: string) => word(hexToBytes(a.toLowerCase().replace(/^0x/, '')));
const hex0x = (b: Uint8Array) => '0x' + bytesToHex(b);

export const TOPIC_LOCKED = hex0x(keccak_256(utf8ToBytes('Locked(bytes32,bytes32,address,address,uint256,uint64)')));
export const TOPIC_CLAIMED = hex0x(keccak_256(utf8ToBytes('Claimed(bytes32,bytes32)')));
export const TOPIC_REFUNDED = hex0x(keccak_256(utf8ToBytes('Refunded(bytes32)')));

export function lockId(sender: string, recipient: string, hashlock: string, refundTime: number, amount: bigint): string {
  return hex0x(keccak_256(concatBytes(addr(sender), addr(recipient), hexToBytes(hashlock), uint(BigInt(refundTime)), uint(amount))));
}

export const encodeLock = (hashlock: string, recipient: string, refundTime: number) =>
  hex0x(concatBytes(sel('lock(bytes32,address,uint64)'), hexToBytes(hashlock), addr(recipient), uint(BigInt(refundTime))));
export const encodeClaim = (id: string, secret: Uint8Array) =>
  hex0x(concatBytes(sel('claim(bytes32,bytes32)'), hexToBytes(id.replace(/^0x/, '')), secret));
export const encodeRefund = (id: string) => hex0x(concatBytes(sel('refund(bytes32)'), hexToBytes(id.replace(/^0x/, ''))));
const encodeLocks = (id: string) => hex0x(concatBytes(sel('locks(bytes32)'), hexToBytes(id.replace(/^0x/, ''))));

// ---------- reading ----------

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

/** Is the contract at `address` exactly our LokyxSwap? Anything else could be a trap. */
export async function verifyContract(net: EvmNet, address: string): Promise<boolean> {
  if (!isEthAddress(address)) return false;
  const code = await rpc<string>(net.rpc, 'eth_getCode', [address, 'latest']);
  return code.toLowerCase() === SWAP_RUNTIME.toLowerCase();
}

export interface EthLockState {
  tip: number;
  /** Latest block's timestamp: what the contract compares refundTime with. */
  now: number;
  open: { amount: bigint; confirmations: number } | null;
  claimed: { secret: Uint8Array; confirmations: number } | null;
  refunded: { confirmations: number } | null;
}

interface RawLog {
  topics: string[];
  data: string;
  blockNumber: string;
}

export async function watchLock(net: EvmNet, contract: string, id: string, fromBlock: number): Promise<EthLockState> {
  const [tipHex, block] = await Promise.all([
    rpc<string>(net.rpc, 'eth_blockNumber', []),
    rpc<{ timestamp: string }>(net.rpc, 'eth_getBlockByNumber', ['latest', false]),
  ]);
  const tip = Number(tipHex);
  const conf = (bn: string) => tip - Number(bn) + 1;
  const logs = await rpc<RawLog[]>(net.rpc, 'eth_getLogs', [
    { address: contract, fromBlock: '0x' + Math.max(0, fromBlock).toString(16), toBlock: 'latest', topics: [[TOPIC_LOCKED, TOPIC_CLAIMED, TOPIC_REFUNDED], id] },
  ]);
  const locked = logs.find((l) => l.topics[0] === TOPIC_LOCKED);
  const claimed = logs.find((l) => l.topics[0] === TOPIC_CLAIMED);
  const refunded = logs.find((l) => l.topics[0] === TOPIC_REFUNDED);
  const raw = await rpc<string>(net.rpc, 'eth_call', [{ to: contract, data: encodeLocks(id) }, 'latest']);
  const words = raw.replace(/^0x/, '').match(/.{64}/g) ?? [];
  const amount = words[2] ? BigInt('0x' + words[2]) : 0n;
  return {
    tip,
    now: Number(block.timestamp),
    open: amount > 0n ? { amount, confirmations: locked ? conf(locked.blockNumber) : 0 } : null,
    claimed: claimed ? { secret: hexToBytes(claimed.data.replace(/^0x/, '').slice(0, 64)), confirmations: conf(claimed.blockNumber) } : null,
    refunded: refunded ? { confirmations: conf(refunded.blockNumber) } : null,
  };
}

export async function latest(net: EvmNet): Promise<{ number: number; timestamp: number }> {
  const b = await rpc<{ number: string; timestamp: string }>(net.rpc, 'eth_getBlockByNumber', ['latest', false]);
  return { number: Number(b.number), timestamp: Number(b.timestamp) };
}

// ---------- MetaMask ----------

interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
const provider = (): Provider | null => (window as unknown as { ethereum?: Provider }).ethereum ?? null;
export const hasWallet = () => provider() !== null;

export async function connectWallet(): Promise<string> {
  const p = provider();
  if (!p) throw new Error('No Ethereum wallet found. Install MetaMask.');
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.length) throw new Error('No account shared');
  return accounts[0];
}

async function onChain(net: EvmNet) {
  const p = provider()!;
  const want = '0x' + net.chainId.toString(16);
  const cur = (await p.request({ method: 'eth_chainId' })) as string;
  if (cur?.toLowerCase() === want) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: want, chainName: net.name, rpcUrls: [net.rpc], nativeCurrency: { name: net.symbol, symbol: net.symbol, decimals: 18 } }],
    });
  }
}

/** Send a contract call from `from` through the wallet. Returns the tx hash. */
export async function send(net: EvmNet, from: string, to: string, data: string, value = 0n): Promise<string> {
  const p = provider();
  if (!p) throw new Error('No Ethereum wallet found');
  await onChain(net);
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts.map((a) => a.toLowerCase()).includes(from.toLowerCase())) {
    throw new Error(`Switch MetaMask to the account ${from.slice(0, 8)}…${from.slice(-6)}; this swap was set up with it`);
  }
  return (await p.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, data, value: '0x' + value.toString(16) }],
  })) as string;
}

/** Deploy LokyxSwap through the wallet and wait for its address. */
export async function deploySwapContract(net: EvmNet): Promise<string> {
  const p = provider();
  if (!p) throw new Error('No Ethereum wallet found');
  await onChain(net);
  const [from] = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  const hash = (await p.request({ method: 'eth_sendTransaction', params: [{ from, data: SWAP_BYTECODE }] })) as string;
  for (let i = 0; i < 120; i++) {
    const r = await rpc<{ contractAddress: string; status: string } | null>(net.rpc, 'eth_getTransactionReceipt', [hash]);
    if (r) {
      if (r.status !== '0x1') throw new Error('Deployment failed');
      return r.contractAddress;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('Deployment not confirmed yet; check your wallet');
}
