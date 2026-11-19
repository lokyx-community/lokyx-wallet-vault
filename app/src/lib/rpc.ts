// JSON-RPC client + hooks

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const NODE_KEY = 'lokyx.node';

const isLocal = typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Built for a public site: talk to the node behind the same origin. Run locally: your own testnet node. */
export const DEFAULT_NODE: string =
  import.meta.env.VITE_DEFAULT_NODE || (isLocal ? 'http://127.0.0.1:28701' : `${location.origin}/rpc`);

export const FAUCET_URL: string =
  import.meta.env.VITE_FAUCET_URL || (isLocal ? 'http://127.0.0.1:8701' : `${location.origin}/faucet`);

export const NODE_PRESETS: { label: string; url: string }[] = [
  ...(isLocal ? [] : [{ label: "This site's node", url: `${location.origin}/rpc` }]),
  { label: 'Testnet node on this computer', url: 'http://127.0.0.1:28701' },
  { label: 'Devnet node on this computer', url: 'http://127.0.0.1:18701' },
];

let nodeUrl = (typeof localStorage !== 'undefined' && localStorage.getItem(NODE_KEY)) || DEFAULT_NODE;
const listeners = new Set<() => void>();

export function getNodeUrl() {
  return nodeUrl;
}

export function setNodeUrl(url: string) {
  nodeUrl = url.replace(/\/+$/, '');
  try {
    localStorage.setItem(NODE_KEY, nodeUrl);
  } catch {
    /* storage unavailable: keep it for this session */
  }
  listeners.forEach((l) => l());
}

export function useNodeUrl() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => nodeUrl,
  );
}

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
export async function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return rpcAt<T>(nodeUrl, method, params);
}

/** True for a node on this computer. */
export const isLocalUrl = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url);

/** Same as `rpc`, against a node other than the one picked in Settings. */
export async function rpcAt<T = unknown>(nodeUrl: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(nodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
  } catch {
    throw new RpcError(`Can't reach a node at ${nodeUrl}`, undefined, true);
  }
  if (!res.ok) throw new RpcError(`Node answered HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new RpcError(body.error.message, body.error.code);
  return body.result as T;
}

export interface Poll<T> {
  data: T | undefined;
  error: RpcError | undefined;
  loading: boolean;
  refresh: () => void;
}

/** Call a method now and then every `everyMs` (0 = once). Re-runs when `key` changes. */
export function usePoll<T>(method: string, params: Record<string, unknown> | null, everyMs = 3000, key: unknown = ''): Poll<T> {
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
    setLoading(true);
    run();
    const t = everyMs > 0 ? setInterval(run, everyMs) : undefined;
    return () => {
      alive.current = false;
      if (t) clearInterval(t);
    };
  }, [run, everyMs, key]);

  return { data, error, loading, refresh: run };
}

// ---------- response shapes (mirrors src/rpc.rs) ----------

export interface ChainInfo {
  network: string;
  chainId: number;
  genesisHash: string;
  genesisMessage: string;
  height: number;
  bestHash: string;
  bestTimestamp: number;
  difficulty: string;
  nextDifficulty: string;
  cumulativeWork: string;
  targetBlockTime: number;
  coinbaseMaturity: number;
  networkHashrateEstimate: number;
  issued: string;
  issuedLyx: string;
  mempoolSize: number;
  peers: number;
  pendingHeaders: number;
  bestHeaderHeight: number;
  synced: boolean;
  version: string;
  deployAddress?: string;
  gasPrice?: string;
  contracts?: number;
  /** Whether the next block may carry contract deploys and calls (missing on older nodes: on). */
  contractsActive?: boolean;
  contractsFrom?: number | null;
  /** Set when the node has stopped applying blocks because its supply check failed. */
  halted?: string | null;
}

/** Contract features are shown only on networks where contracts are switched on. */
export const contractsOn = (info?: ChainInfo | null) => info?.contractsActive !== false;

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
  swap?:
    | { kind: 'lock'; id: string; hashlock: string; recipient: string; refundHeight: number }
    | { kind: 'claim'; id: string; secret: string }
    | { kind: 'refund'; id: string };
  blockHeight?: number;
  blockHash?: string;
  confirmations?: number;
  key?: { kind: 'commitPq'; hash: string };
  contract?:
    | { kind: 'deploy'; gasLimit: number; codeBytes: number; address: string | null }
    | { kind: 'call'; gasLimit: number; method: string | null; input: string };
  receipt?: RunResult & { fee: string; feeLyx: string; contract: string | null };
  vault?: {
    kind: 'create' | 'withdraw' | 'update' | 'close' | 'cancel' | 'sweep' | 'heirClaim';
    id?: string;
    to?: string;
    amountLyx?: string;
    vault?: string;
    settings?: VaultSettingsInfo;
  };
}

export interface BlockInfo {
  hash: string;
  height: number;
  prevHash: string;
  /** Only on block 0: the text its parent hash commits to. */
  message?: string | null;
  timestamp: number;
  difficulty: string;
  cumulativeWork: string | null;
  nonce: string;
  miner: string;
  txRoot: string;
  stateRoot: string;
  reward: string;
  rewardLyx: string;
  fees: string;
  feesLyx: string;
  size: number;
  txCount: number;
  mainChain: boolean;
  confirmations: number;
  transactions: (string | TxInfo)[];
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
  vault: VaultInfo | null;
  /** sha3-256 of the account's post-quantum key, once committed */
  pqCommit: string | null;
  /** The key (as an address) that signs for this account; the account's own address until it rotates. */
  controller?: string;
  pendingRotation?: { newKey: string; releaseHeight: number } | null;
  recoveryFor: string[];
  heirOf: string[];
  contract: ContractInfo | null;
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
  maxGasFeeLyx: string;
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

export interface MiningInfo {
  enabled: boolean;
  threads: number;
  maxThreads: number;
  algorithm: string;
  coinbase: string | null;
  hashrate: number;
  hashesTotal: number;
  blocksFound: number;
  blocksAcceptedLocally: number;
  blocksStale: number;
  blocksRejected: number;
  lastAcceptedBlock: { height: number; hash: string } | null;
  networkDifficulty: string;
  networkHashrateEstimate: number;
  expectedSecondsPerBlockAtThisHashrate: number | null;
  nextBlockDue?: number;
  now?: number;
  minBlockSpacing?: number;
  waiting?: boolean;
  nextBlockRewardLyx: string;
}

export interface Peer {
  address: string;
  listenAddress: string;
  direction: 'inbound' | 'outbound';
  bestHeight: number;
  userAgent: string;
  connectedSecs: number;
  lastSeenSecs: number;
  misbehavior: number;
}

export interface Supply {
  height: number;
  issued: string;
  issuedLyx: string;
  expectedFromSchedule: string;
  sumOfAllBalances: string;
  lockedRewards: string;
  /** Part of sumOfAllBalances, not on top of it. */
  inContracts?: string;
  contracts?: number;
  consistent: boolean;
  currentBlockRewardLyx: string;
  nextHalvingHeight: number;
  tailRewardLyx: string;
  maxSupply: null;
  premine: string;
  treasuryAllocation: string;
  developerAllocation: string;
  accounts: number;
}
