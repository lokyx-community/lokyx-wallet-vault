// Copied from the website (app/src/lib/eth.ts), reading and encoding only. The phone signs with its own key.
// Ethereum side of a swap: the LokyxSwap contract (contracts/LokyxSwap.sol) on an EVM chain.
// Reads go to a public RPC; writes go through MetaMask (window.ethereum).
//
// A lock's id is keccak256(abi.encode(sender, recipient, hashlock, refundTime, amount)), so both
// sides can work it out in advance, and a lock found at that id matches the deal by construction.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { SWAP_RUNTIME } from './swap-contract.ts';

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

