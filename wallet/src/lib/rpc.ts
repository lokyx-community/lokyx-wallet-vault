// Talking to a LOKYX node over JSON-RPC.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { cleanUrl, order, vetNode, type NodeEntry, type Pin, type Vet } from './nodes-core.ts';

export const PUBLIC_NODE = 'https://testnet.lokyx.xyz/rpc';
/** The chain this wallet is for. 77703 is the 0.5.0 testnet. */
export const EXPECT_CHAIN_ID = 77703;
export const BUILTIN_NODES: NodeEntry[] = [{ url: PUBLIC_NODE, label: 'LOKYX testnet', builtin: true }];

const node = store(PUBLIC_NODE);
const nodes = store<NodeEntry[]>(BUILTIN_NODES);
let pin: Pin | null = null;
const downUntil: Record<string, number> = {};
const vetted = new Map<string, { at: number; v: Vet }>();
export const getNodeUrl = () => node.get();
export const useNodeUrl = () => useStore(node);
export const useNodes = () => useStore(nodes);

export async function loadNode() {
  const [saved, list, p] = await Promise.all([getItem('w.node'), getItem('w.nodes'), getItem('w.genesis')]);
  try {
    const extra: NodeEntry[] = list ? JSON.parse(list) : [];
    nodes.set([...BUILTIN_NODES, ...extra.filter((n) => !n.builtin && !BUILTIN_NODES.some((b) => b.url === n.url))]);
  } catch {}
  if (p) try { pin = JSON.parse(p); } catch {}
  if (saved) node.set(saved);
}
const saveNodes = () => setItem('w.nodes', JSON.stringify(nodes.get().filter((n) => !n.builtin)));

/** Make a node the first choice. It still has to pass the network check before it's used. */
export async function setNodeUrl(url: string) {
  const u = url.trim().replace(/\/+$/, '');
  node.set(u);
  await setItem('w.node', u);
}

/** Check a node, then add it to the list. Throws with a plain reason if it is on another network. */
export async function addNode(url: string, label?: string) {
  const u = cleanUrl(url);
  if (!u) throw new Error('Enter an address like http://192.168.1.20:28701');
  const v = await vetUrl(u, true);
  if (!v.ok) throw new Error(v.reason);
  if (!nodes.get().some((n) => n.url === u)) {
    nodes.set([...nodes.get(), { url: u, label: label?.trim() || u.replace(/^https?:\/\//, '') }]);
    await saveNodes();
  }
  await setNodeUrl(u);
}

export async function removeNode(url: string) {
  nodes.set(nodes.get().filter((n) => n.builtin || n.url !== url));
  await saveNodes();
  if (node.get() === url) await setNodeUrl(PUBLIC_NODE);
}

/** Forget the remembered genesis, to move the wallet to a reset network. */
export async function forgetPin() {
  pin = null;
  vetted.clear();
  await setItem('w.genesis', '');
}

async function vetUrl(url: string, fresh = false): Promise<Vet> {
  const hit = vetted.get(url);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  const info = await rpcOnce<ChainInfo & { genesisHash?: string }>('lyx_chainInfo', {}, url);
  const v = vetNode(info, EXPECT_CHAIN_ID, pin);
  vetted.set(url, { at: Date.now(), v });
  if (v.ok && !pin) {
    pin = v.pin;
    await setItem('w.genesis', JSON.stringify(pin));
  }
  return v;
}

/** Why a node was turned away, for the Network screen. */
export const refusals = store<Record<string, string>>({});

/** The faucet sits next to the node on the public site. */
export const faucetUrl = () => node.get().replace(/\/rpc$/, '/faucet');
/** The website that goes with the node, for the explorer. */
export const siteUrl = () => node.get().replace(/\/rpc$/, '');

export class RpcError extends Error {
  code?: number;
  unreachable: boolean;
  constructor(message: string, code?: number, unreachable = false) {
    super(message);
    this.code = code;
    this.unreachable = unreachable;
  }
}

let id = 0;
async function rpcOnce<T>(method: string, params: Record<string, unknown>, url: string): Promise<T> {
  let res: Response;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: ctl.signal,
    });
  } catch {
    throw new RpcError("Can't reach the network right now", undefined, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new RpcError(`The node answered ${res.status}`, undefined, res.status >= 500);
  const body = await res.json();
  if (body.error) throw new RpcError(body.error.message, body.error.code);
  return body.result as T;
}

/**
 * Ask the network. With no `url`, the chosen node is tried first; if it is down, or turns out to be on a
 * different network, the next node on the list is used, and the one that worked becomes the active node.
 * Every node is checked (chain id and genesis hash) before it is believed.
 */
export async function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}, url?: string): Promise<T> {
  if (url) return rpcOnce<T>(method, params, url);
  const tried = order(nodes.get(), node.get(), downUntil, Date.now());
  let last: RpcError = new RpcError("Can't reach the network right now", undefined, true);
  for (const n of tried) {
    try {
      const v = await vetUrl(n.url);
      if (!v.ok) {
        refusals.set({ ...refusals.get(), [n.url]: v.reason });
        last = new RpcError(v.reason);
        continue;
      }
      if (refusals.get()[n.url]) refusals.set({ ...refusals.get(), [n.url]: '' });
      const r = await rpcOnce<T>(method, params, n.url);
      delete downUntil[n.url];
      if (n.url !== node.get()) {
        node.set(n.url);
        setItem('w.node', n.url).catch(() => {});
      }
      return r;
    } catch (e) {
      if (e instanceof RpcError && !e.unreachable) throw e;
      downUntil[n.url] = Date.now() + 30_000;
      last = e as RpcError;
    }
  }
  throw last;
}

// Pause polling while the app is in the background.
let active = AppState.currentState !== 'background';
const wake = new Set<() => void>();
AppState.addEventListener('change', (s) => {
  const now = s === 'active';
  if (now && !active) wake.forEach((f) => f());
  active = now;
});

export interface Poll<T> {
  data: T | undefined;
  error: RpcError | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
}

/** Call a method now and then every `everyMs` (0 = once). `params` null means wait. */
export function usePoll<T>(method: string, params: Record<string, unknown> | null, everyMs = 5000): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<RpcError>();
  const [loading, setLoading] = useState(true);
  const url = useNodeUrl();
  const p = JSON.stringify(params);
  const alive = useRef(true);

  const run = useCallback(async () => {
    if (params === null) return;
    try {
      const r = await rpc<T>(method, params);
      if (alive.current) {
        setData(r);
        setError(undefined);
      }
    } catch (e) {
      if (alive.current) setError(e as RpcError);
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, p, url]);

  useEffect(() => {
    alive.current = true;
    setData(undefined);
    setLoading(true);
    run();
    const t = everyMs > 0 ? setInterval(() => active && run(), everyMs) : undefined;
    wake.add(run);
    return () => {
      alive.current = false;
      wake.delete(run);
      if (t) clearInterval(t);
    };
  }, [run, everyMs]);

  return { data, error, loading, refresh: run };
}

// ---------- shapes (see src/rpc.rs in the node) ----------

export interface ChainInfo {
  network: string;
  chainId: number;
  height: number;
  bestHash: string;
  bestTimestamp: number;
  targetBlockTime: number;
  coinbaseMaturity: number;
  networkHashrateEstimate: number;
  mempoolSize: number;
  peers: number;
  version: string;
  issuedLyx: string;
  contracts?: number;
  /** Whether the next block may carry contract transactions. Missing on older nodes: on. */
  contractsActive?: boolean;
  contractsFrom?: number | null;
}

export type AbiParam = [string, string];
export interface AbiMethod {
  name: string;
  args: AbiParam[];
  returns?: string | string[];
  view?: boolean;
  payable?: boolean;
}
export interface Abi {
  name?: string;
  deploy?: AbiParam[];
  methods: AbiMethod[];
  events?: { name: string; fields: AbiParam[] }[];
}

export interface ContractInfo {
  address: string;
  creator: string;
  height: number;
  codeHash: string;
  codeBytes: number;
  abi: Abi | null;
  storageEntries: number;
}

export interface VaultSettingsInfo {
  recovery: string;
  safe: string;
  delayBlocks: number;
  allowance: string;
  allowanceLyx: string;
  heir: { address: string; inactiveBlocks: number } | null;
}

export interface PendingInfo {
  id: string;
  vault: string;
  kind: 'withdraw' | 'update' | 'close';
  releaseHeight: number;
  height: number;
  byHeir: boolean;
  to?: string;
  amount?: string;
  amountLyx?: string;
  settings?: VaultSettingsInfo;
}

export interface VaultInfo {
  settings: VaultSettingsInfo;
  allowanceLeft: string;
  allowanceLeftLyx: string;
  dayResetsAt: number;
  lastActive: number;
  heirCanClaimFrom: number | null;
  pending: PendingInfo[];
}

export interface Account {
  address: string;
  balance: string;
  balanceLyx: string;
  nonce: number;
  pendingNonce: number;
  atHeight: number;
  locked: string;
  lockedLyx: string;
  /** Set when the account is a vault. */
  vault?: VaultInfo | null;
  /** The key (as an address) that signs for this account; the account's own address until it rotates. */
  controller?: string;
  pendingRotation?: { newKey: string; releaseHeight: number } | null;
  /** Vaults this address is the recovery key of, and vaults it is the heir of. */
  recoveryFor?: string[];
  heirOf?: string[];
  contract: ContractInfo | null;
}

export interface ContractLog {
  contract: string;
  event: string;
  data: string;
  fields: Record<string, unknown> | null;
}

export interface RunResult {
  ok: boolean;
  gasUsed: number;
  output: string;
  result: unknown;
  error: string | null;
  logs: ContractLog[];
}

export interface GasEstimate {
  ok: boolean;
  error: string | null;
  gasUsed: number;
  gasLimit: number;
  maxGasFee: string;
  maxGasFeeLyx: string;
}

export interface TxInfo {
  hash: string;
  from: string;
  to: string;
  value: string;
  valueLyx: string;
  fee: string;
  feeLyx: string;
  nonce: number;
  size: number;
  status?: 'pending' | 'confirmed';
  blockHeight?: number;
  blockHash?: string;
  confirmations?: number;
  contract?:
    | { kind: 'deploy'; gasLimit: number; codeBytes: number; address: string | null }
    | { kind: 'call'; gasLimit: number; method: string | null; input: string };
  receipt?: RunResult & { fee: string; feeLyx: string; contract: string | null };
}

export interface HistoryItem {
  kind: 'mined' | 'sent' | 'received' | 'self';
  height: number;
  blockHash: string;
  timestamp: number;
  confirmations: number;
  txHash?: string;
  from?: string;
  to?: string;
  amount: string;
  amountLyx: string;
  feeLyx?: string;
}

export interface History {
  address: string;
  total: number;
  blocksMined: number;
  items: HistoryItem[];
  nextBefore: number | null;
}
