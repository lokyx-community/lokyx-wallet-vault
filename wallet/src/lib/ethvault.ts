// Ethereum vault on Base Sepolia and Arbitrum Sepolia: RPC, per-network settings, creating and using the vault,
// and reading its live state. All rules and encodings live in ethvault-core.ts (tested against the real contracts).
// Keys stay on the phone. The only servers involved are the public RPC endpoints (no key, nothing secret sent).

import { switchHooks } from "./ns";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getItem, setItem } from "./kv";
import { store } from "./store";
import { readPhrase, resetHooks } from "./wallet";
import { ensureAddresses } from "./multichain";
import { ethKey } from "./multichain-core";
import {
  ABI,
  CONTRACTS,
  DEFAULT_WAIT,
  ETH,
  VAULT_NETS,
  activationTx,
  allowanceData,
  allowanceSpend,
  checkSettings,
  creationCalls,
  deploymentOf,
  diffConfig,
  execTransactionData,
  gasReserve,
  keyHex,
  phoneCancelData,
  resetAdjusted,
  queueData,
  gateQueueData,
  refuseQueue,
  executeData,
  readLive,
  refuseToBuild,
  safeTxHash,
  signAction,
  recoveryCancelData,
  recoverySweepCalls,
  sweepable,
  submission,
  tokenTransferCall,
  vaultAddresses,
  type Deployment,
  type Expected,
  type Holding,
  type Issue,
  type KnownToken,
  type Live,
  type QueuedItem,
  type Reader,
  type SafeTx,
  type TokenAllowance,
  type VaultNet,
} from "./ethvault-core";
import { ethAlerts, startedKey, type EthAlert } from "./ethvault-watch-core";

export const NETS = Object.keys(VAULT_NETS) as VaultNet[];

/** Circle's test USDC (from Circle's developer docs; the app checks symbol and decimals on chain before using it). */
/** A network without a known test USDC has no entry; its vault holds the coin only until one is added. */
export const USDC: Partial<Record<VaultNet, Hex>> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "arbitrum-sepolia": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  // Circle's test USDC on Optimism Sepolia. The app checks symbol and decimals on chain before relying on it.
  "op-sepolia": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
};
export const tokensOn = (net: VaultNet): KnownToken[] => {
  const a = USDC[net];
  return a ? [{ address: a, symbol: "USDC", decimals: 6 }] : [];
};

// ---------- RPC ----------

async function rpc<T>(
  net: VaultNet,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const r = await fetch(VAULT_NETS[net].rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok)
    throw new Error(`The ${VAULT_NETS[net].label} server answered ${r.status}`);
  const b = (await r.json()) as { result?: T; error?: { message: string } };
  if (b.error) throw new Error(b.error.message);
  return b.result as T;
}
const checked = new Set<VaultNet>();
async function ensureChain(net: VaultNet) {
  if (checked.has(net)) return;
  const id = Number(BigInt(await rpc<string>(net, "eth_chainId")));
  if (id !== VAULT_NETS[net].chainId)
    throw new Error(
      `That server is on chain ${id}, not ${VAULT_NETS[net].chainId}.`,
    );
  checked.add(net);
}
export const reader = (net: VaultNet): Reader => ({
  call: async (to, data) => (
    await ensureChain(net),
    rpc<Hex>(net, "eth_call", [{ to, data }, "latest"])
  ),
  code: async (a) => (
    await ensureChain(net),
    rpc<Hex>(net, "eth_getCode", [a, "latest"])
  ),
});
export const balanceOf = async (net: VaultNet, a: Hex) =>
  BigInt(await rpc<string>(net, "eth_getBalance", [a, "latest"]));
export async function gasPrice(net: VaultNet): Promise<bigint> {
  return BigInt(await rpc<string>(net, "eth_gasPrice"));
}
async function tokenBal(net: VaultNet, token: Hex, who: Hex): Promise<bigint> {
  const data = encodeFunctionData({
    abi: ABI.erc20,
    functionName: "balanceOf",
    args: [who],
  });
  return decodeFunctionResult({
    abi: ABI.erc20,
    functionName: "balanceOf",
    data: await reader(net).call(token, data),
  }) as bigint;
}

// ---------- per-network settings (the same vault address has separate settings on each network) ----------

export interface NetVault {
  net: VaultNet;
  /** the 12-word recovery key's address (the Safe's only owner). The key itself is never stored. */
  recovery: Hex;
  /** where a sweep sends everything */
  sweepTo: Hex;
  wait: number;
  allowances: {
    token: Hex;
    symbol: string;
    decimals: number;
    amount: string;
  }[];
  /** block to start reading the Delay's log from */
  fromBlock: number;
  state: "created" | "live";
  /** made by the build where the Safe owner ends as the dead address; older vaults still have the recovery key as owner */
  locked?: boolean;
  /** made with a gate: the phone can queue only ETH and listed tokens to the safe address, and the settings can never change. Older vaults let the phone queue anything. */
  gated?: boolean;
  /** settings changes queued by this phone: what the settings become once each one has run */
  changes?: {
    key: string;
    wait?: number;
    allowance?: { token: Hex; amount: string };
  }[];
}
export const vaults = store<Partial<Record<VaultNet, NetVault>>>({});
const K = (n: VaultNet) => `w.ethvault.${n}`;

export async function loadVaults() {
  const out: Partial<Record<VaultNet, NetVault>> = {};
  for (const n of NETS) {
    try {
      const raw = await getItem(K(n));
      if (raw) out[n] = JSON.parse(raw);
    } catch {}
  }
  vaults.set(out);
}
export async function saveVault(v: NetVault) {
  vaults.set({ ...vaults.get(), [v.net]: v });
  await setItem(K(v.net), JSON.stringify(v));
}
switchHooks.push(() => loadVaults());
resetHooks.push(() => {
  vaults.set({});
  NETS.forEach((n) => setItem(K(n), "").catch(() => {}));
});

export const toSettings = (
  v: NetVault,
): { wait: number; allowances: TokenAllowance[] } => ({
  wait: v.wait,
  allowances: v.allowances.map((a) => ({
    token: a.token,
    symbol: a.symbol,
    decimals: a.decimals,
    amount: BigInt(a.amount),
  })),
});

/** Addresses of this phone's vault (the same on every network). */
export async function addressesFor(
  recovery: Hex,
  d: Deployment = deploymentOf(),
) {
  const a = await ensureAddresses();
  return {
    phone: a.eth as Hex,
    ...vaultAddresses({ recovery, phone: a.eth as Hex }, d),
  };
}
export const expectedFor = async (v: NetVault): Promise<Expected> => {
  const d = deploymentOf();
  const ad = await addressesFor(v.recovery, d);
  const s = toSettings(v);
  return {
    safe: ad.safe,
    delay: ad.delay,
    roles: ad.roles,
    phone: ad.phone,
    recovery: v.recovery,
    wait: s.wait,
    allowances: s.allowances,
    deployment: d,
    legacyOwner: !v.locked,
    ...(v.gated ? { gate: ad.gate } : {}),
  };
};

// ---------- sending from the phone's everyday address (it pays gas) ----------

/** `sk`: the phone's everyday key when the caller already has it, so several sends in a row ask the phone only once. */
export async function phoneSend(
  net: VaultNet,
  to: Hex,
  data: Hex,
  value = 0n,
  sk?: Uint8Array,
): Promise<Hex> {
  await ensureChain(net);
  let own: { sk: Uint8Array } | null = null;
  if (!sk) {
    const phrase = await readPhrase();
    if (!phrase) throw new Error("No recovery words on this phone");
    own = ethKey(phrase);
    sk = own.sk;
  }
  try {
    const acct = privateKeyToAccount(keyHex(sk));
    const [nonce, price, tip] = await Promise.all([
      rpc<string>(net, "eth_getTransactionCount", [acct.address, "pending"]),
      gasPrice(net),
      rpc<string>(net, "eth_maxPriorityFeePerGas").catch(() => "0x0"),
    ]);
    const est = BigInt(
      await rpc<string>(net, "eth_estimateGas", [
        { from: acct.address, to, data, value: `0x${value.toString(16)}` },
      ]),
    );
    const raw = await acct.signTransaction({
      type: "eip1559",
      chainId: VAULT_NETS[net].chainId,
      nonce: Number(BigInt(nonce)),
      to,
      data,
      value,
      gas: (est * 130n) / 100n,
      maxFeePerGas: price * 2n + BigInt(tip),
      maxPriorityFeePerGas: BigInt(tip),
    });
    return await rpc<Hex>(net, "eth_sendRawTransaction", [raw]);
  } finally {
    own?.sk.fill(0);
  }
}
export async function waitReceipt(net: VaultNet, hash: Hex, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await rpc<{
      status: string;
      blockNumber: string;
      logs: { address: Hex; topics: Hex[]; data: Hex }[];
    } | null>(net, "eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status === "0x0")
        throw new Error(
          "It was included in a block but failed. Only the network fee was spent.",
        );
      return r;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("Still waiting for the network. Check again in a minute.");
}

// ---------- creating and activating ----------

/** Every contract the vault depends on must exist on the network, and the ones with a pinned hash must match it. */
export async function checkDeployments(net: VaultNet): Promise<string | null> {
  const r = reader(net);
  for (const [name, c] of Object.entries(CONTRACTS)) {
    const code = await r.code(c.address);
    if (code === "0x")
      return `The audited ${name} contract is not on ${VAULT_NETS[net].label} yet, so a vault cannot be created here. It has to be deployed there first (docs/ETH_VAULT.md).`;
  }
  return null;
}

/**
 * Which audited vault parts are already on a network. A network where some are missing needs the one-time setup
 * (the parts placed from their official build) before a vault can be made there. Never throws: when the network
 * can't be reached the answer is `null`.
 */
export async function partsStatus(net: VaultNet): Promise<{ ready: boolean; missing: string[] } | null> {
  try {
    const r = reader(net);
    const missing: string[] = [];
    for (const [name, c] of Object.entries(CONTRACTS)) if ((await r.code(c.address)) === "0x") missing.push(name);
    return { ready: missing.length === 0, missing };
  } catch {
    return null;
  }
}

export interface Progress {
  (step: "checking" | "deploying" | "activating" | "verifying" | "done"): void;
}

/** Deploys the Safe and the two modules (the phone pays), then activates with the recovery key's signature. */
export async function createVault(p: {
  net: VaultNet;
  recoverySk: Uint8Array;
  recovery: Hex;
  sweepTo: Hex;
  settings: { wait: number; allowances: TokenAllowance[] };
  onStep?: Progress;
}): Promise<NetVault> {
  const { net, settings } = p;
  const bad = checkSettings(settings);
  if (bad) throw new Error(bad);
  p.onStep?.("checking");
  const missing = await checkDeployments(net);
  if (missing) throw new Error(missing);
  const d = deploymentOf();
  const a = await ensureAddresses();
  const plan = {
    recovery: p.recovery,
    phone: a.eth as Hex,
    safeAddress: p.sweepTo,
  };
  const ad = vaultAddresses(plan, d);
  const fromBlock = Number(BigInt(await rpc<string>(net, "eth_blockNumber")));
  // the phone's key is read once for the whole setup: one fingerprint, not one per transaction
  const phrase = await readPhrase();
  if (!phrase) throw new Error("No recovery words on this phone");
  const phoneKey = ethKey(phrase);
  try {
    p.onStep?.("deploying");
    for (const c of creationCalls(plan, d)) {
      // already deployed here (a retry, or created before)? skip it
      const target = c.to === d.safeProxyFactory ? ad.safe : undefined;
      if (target && (await reader(net).code(target)) !== "0x") continue;
      await waitReceipt(
        net,
        await phoneSend(net, c.to, c.data ?? "0x", 0n, phoneKey.sk),
      );
    }
    p.onStep?.("activating");
    const safeNonce = BigInt(
      decodeFunctionResult({
        abi: ABI.safe,
        functionName: "nonce",
        data: await reader(net).call(
          ad.safe,
          encodeFunctionData({ abi: ABI.safe, functionName: "nonce" }),
        ),
      }) as bigint,
    );
    if (safeNonce === 0n) {
      const tx = activationTx(plan, settings, d, 0n);
      const sig = await signAction(
        keyHex(p.recoverySk),
        VAULT_NETS[net].chainId,
        ad.safe,
        "cancel",
        tx,
        "Activate the vault",
      );
      const s = submission(sig);
      await waitReceipt(
        net,
        await phoneSend(net, s.to, s.data, 0n, phoneKey.sk),
      );
    }
  } finally {
    phoneKey.sk.fill(0);
  }
  p.onStep?.("verifying");
  const v: NetVault = {
    net,
    recovery: p.recovery,
    sweepTo: p.sweepTo,
    wait: settings.wait,
    fromBlock,
    state: "live",
    locked: true,
    gated: true,
    allowances: settings.allowances.map((t) => ({
      token: t.token,
      symbol: t.symbol,
      decimals: t.decimals,
      amount: t.amount.toString(),
    })),
  };
  const issues = await checkLive(v);
  const danger = issues.filter((i) => i.level === "danger");
  if (danger.length)
    throw new Error(
      `The vault was created but does not look right: ${danger[0].text}. Do not put money in it.`,
    );
  await saveVault(v);
  p.onStep?.("done");
  return v;
}

// ---------- reading the vault ----------

export async function checkLive(v: NetVault): Promise<Issue[]> {
  const e = await expectedFor(v);
  return diffConfig(e, await readLive(reader(v.net), e));
}

export async function queuedItems(
  v: NetVault,
  e: Expected,
  live: Live,
): Promise<QueuedItem[]> {
  const out: QueuedItem[] = [];
  if (live.delay.queueNonce === live.delay.txNonce) return out;
  const logs = await rpc<{ address: Hex; topics: Hex[]; data: Hex }[]>(
    v.net,
    "eth_getLogs",
    [
      {
        address: e.delay,
        fromBlock: `0x${v.fromBlock.toString(16)}`,
        toBlock: "latest",
      },
    ],
  );
  const events = parseEventLogs({
    abi: ABI.delay,
    eventName: "TransactionAdded",
    logs: logs as never,
  });
  for (const ev of events) {
    const a = ev.args as {
      queueNonce: bigint;
      txHash: Hex;
      to: Hex;
      value: bigint;
      data: Hex;
      operation: number;
    };
    if (a.queueNonce < live.delay.txNonce) continue;
    const created = BigInt(
      decodeFunctionResult({
        abi: ABI.delay,
        functionName: "getTxCreatedAt",
        data: await reader(v.net).call(
          e.delay,
          encodeFunctionData({
            abi: ABI.delay,
            functionName: "getTxCreatedAt",
            args: [a.queueNonce],
          }),
        ),
      }) as bigint,
    );
    out.push({
      nonce: a.queueNonce,
      txHash: a.txHash,
      to: a.to,
      value: a.value,
      data: a.data,
      operation: a.operation,
      createdAt: Number(created),
      readyAt: Number(created + live.delay.cooldown),
      expiresAt:
        live.delay.expiration === 0n
          ? Number.MAX_SAFE_INTEGER
          : Number(created + live.delay.cooldown + live.delay.expiration),
    });
  }
  return out;
}

export interface Snapshot {
  expected: Expected;
  live: Live;
  issues: Issue[];
  items: QueuedItem[];
  eth: bigint;
  tokens: { token: KnownToken; amount: bigint }[];
  /** what the phone can still spend today without waiting, per token (raw units) */
  today: { token: Hex; left: bigint }[];
  recoveryGas: ReturnType<typeof gasReserve>;
  phoneGas: bigint;
}

export async function snapshot(v: NetVault): Promise<Snapshot> {
  const expected = await expectedFor(v);
  const r = reader(v.net);
  const live = await readLive(r, expected);
  const issues = diffConfig(expected, live);
  const items = await queuedItems(v, expected, live);
  const [eth, recBal, phoneBal, price] = await Promise.all([
    balanceOf(v.net, expected.safe),
    balanceOf(v.net, v.recovery),
    balanceOf(v.net, expected.phone),
    gasPrice(v.net),
  ]);
  const tokens = await Promise.all(
    tokensOn(v.net).map(async (t) => ({
      token: t,
      amount: await tokenBal(v.net, t.address, expected.safe),
    })),
  );
  const today = await Promise.all(
    live.allowances.map(async (a) => {
      const t = decodeFunctionResult({
        abi: ABI.allowance,
        functionName: "getTokenAllowance",
        data: await r.call(
          expected.deployment.allowanceModule,
          encodeFunctionData({
            abi: ABI.allowance,
            functionName: "getTokenAllowance",
            args: [expected.safe, expected.phone, a.token],
          }),
        ),
      }) as readonly bigint[];
      return { token: a.token, left: resetAdjusted(t) };
    }),
  );
  return {
    expected,
    live,
    issues,
    items,
    eth,
    tokens,
    today,
    recoveryGas: gasReserve(recBal, price),
    phoneGas: phoneBal,
  };
}

// ---------- everyday actions (clear signing text comes from describeCall in the screens) ----------

/** Send within today's allowance if it fits, otherwise queue it behind the wait. */
export async function sendFromVault(
  v: NetVault,
  snap: Snapshot,
  token: Hex,
  to: Hex,
  amount: bigint,
): Promise<{ how: "instant" | "queued"; hash: Hex }> {
  const call =
    token === ETH
      ? { to, value: amount, data: "0x" as Hex }
      : tokenTransferCall(token, to, amount);
  const refused = refuseToBuild({ to: call.to, data: call.data, operation: 0 });
  if (refused) throw new Error(refused);
  const left =
    snap.today.find((t) => t.token.toLowerCase() === token.toLowerCase())
      ?.left ?? 0n;
  const e = snap.expected;
  const net = v.net;
  if (amount <= left) {
    const phrase = await readPhrase();
    if (!phrase) throw new Error("No recovery words on this phone");
    const k = ethKey(phrase);
    try {
      const t = decodeFunctionResult({
        abi: ABI.allowance,
        functionName: "getTokenAllowance",
        data: await reader(net).call(
          e.deployment.allowanceModule,
          encodeFunctionData({
            abi: ABI.allowance,
            functionName: "getTokenAllowance",
            args: [e.safe, e.phone, token],
          }),
        ),
      }) as readonly bigint[];
      const s = await allowanceSpend(
        keyHex(k.sk),
        VAULT_NETS[net].chainId,
        e.deployment,
        e.safe,
        e.phone,
        { token, to, amount, nonce: Number(t[4]) },
      );
      const hash = await phoneSend(net, s.to, s.data, 0n, k.sk);
      await waitReceipt(net, hash);
      return { how: "instant", hash };
    } finally {
      k.sk.fill(0);
    }
  }
  if (v.gated) {
    const no = refuseQueue(call, v.sweepTo, sweepable({ allowances: v.allowances }));
    if (no) throw new Error(no);
  }
  const hash = v.gated ? await phoneSend(net, e.gate!, gateQueueData(call)) : await phoneSend(net, e.delay, queueData(call));
  const rc = await waitReceipt(net, hash);
  await rememberStarted(net, rc.logs);
  return { how: "queued", hash };
}

/** Queue any call the vault itself makes (a settings change) behind the wait. */
export async function queueSettingChange(
  v: NetVault,
  to: Hex,
  data: Hex,
  apply: { wait?: number; allowance?: { token: Hex; amount: bigint } } = {},
): Promise<Hex> {
  if (v.gated) throw new Error("This vault's settings are fixed when it is made. To change them, make a new vault and move your coins to it.");
  const e = await expectedFor(v);
  const hash = await phoneSend(v.net, e.delay, queueData({ to, data }));
  const rc = await waitReceipt(v.net, hash);
  await rememberStarted(v.net, rc.logs);
  await saveVault({
    ...v,
    changes: [
      ...(v.changes ?? []),
      {
        key: changeKey(to, data),
        wait: apply.wait,
        allowance: apply.allowance && {
          token: apply.allowance.token,
          amount: apply.allowance.amount.toString(),
        },
      },
    ],
  });
  return hash;
}
const changeKey = (to: Hex, data: Hex) => `${to}:${data}`.toLowerCase();
export const allowanceChange = (v: NetVault, t: TokenAllowance) =>
  expectedFor(v).then((e) => ({
    to: e.deployment.allowanceModule,
    data: allowanceData(e.phone, t, 0),
  }));
export const waitChange = (v: NetVault, secs: number) =>
  expectedFor(v).then((e) => ({
    to: e.delay,
    data: encodeFunctionData({
      abi: ABI.delay,
      functionName: "setTxCooldown",
      args: [BigInt(secs)],
    }),
  }));

export async function executeReady(
  v: NetVault,
  item: QueuedItem,
): Promise<Hex> {
  const hash = await phoneSend(
    v.net,
    (await expectedFor(v)).delay,
    executeData({
      to: item.to,
      value: item.value,
      data: item.data,
      operation: item.operation as 0 | 1,
    }),
  );
  await waitReceipt(v.net, hash);
  // a settings change this phone queued has now run: from here on the live check expects the new values
  const fresh = vaults.get()[v.net] ?? v;
  const ch = (fresh.changes ?? []).find(
    (c) => c.key === changeKey(item.to, item.data),
  );
  if (ch) {
    await saveVault({
      ...fresh,
      wait: ch.wait ?? fresh.wait,
      allowances: fresh.allowances.map((a) =>
        ch.allowance &&
        a.token.toLowerCase() === ch.allowance.token.toLowerCase()
          ? { ...a, amount: ch.allowance.amount }
          : a,
      ),
      changes: (fresh.changes ?? []).filter((c) => c !== ch),
    });
  }
  return hash;
}

/** One-slide cancel from the phone (Roles v1: only Delay.setTxNonce). Cancels everything waiting. */
export async function phoneCancel(v: NetVault, snap: Snapshot): Promise<Hex> {
  const hash = await phoneSend(
    v.net,
    snap.expected.roles,
    phoneCancelData(snap.expected.delay, snap.live.delay.queueNonce),
  );
  await waitReceipt(v.net, hash);
  const fresh = vaults.get()[v.net] ?? v;
  if (fresh.changes?.length) await saveVault({ ...fresh, changes: [] });
  return hash;
}

// ---------- recovery key actions (the recovery key sends these itself, through its narrow Roles role) ----------

/** Cancel everything waiting. The recovery key sends it, so its own address pays the fee. */
export async function recoveryCancel(v: NetVault, recoverySk: Uint8Array): Promise<Hex> {
  const e = await expectedFor(v);
  const q = decodeFunctionResult({
    abi: ABI.delay,
    functionName: "queueNonce",
    data: await reader(v.net).call(e.delay, encodeFunctionData({ abi: ABI.delay, functionName: "queueNonce" })),
  }) as bigint;
  const hash = await phoneSend(v.net, e.roles, recoveryCancelData(e.delay, q), 0n, recoverySk);
  await waitReceipt(v.net, hash);
  return hash;
}

/**
 * Move the vault's ETH and its listed tokens to the safe address, one transaction each. Roles lets the recovery key send
 * to that address and nowhere else. Tokens that are not on the vault's allowance list stay where they are.
 */
export async function recoverySweep(v: NetVault, recoverySk: Uint8Array): Promise<Hex[]> {
  const e = await expectedFor(v);
  const listed = sweepable({ allowances: v.allowances });
  const holdings: Holding[] = [{ token: ETH, amount: await balanceOf(v.net, e.safe) }];
  for (const t of tokensOn(v.net)) if (listed.some((x) => x.toLowerCase() === t.address.toLowerCase())) holdings.push({ token: t.address, amount: await tokenBal(v.net, t.address, e.safe) });
  const out: Hex[] = [];
  for (const c of recoverySweepCalls(e.roles, v.sweepTo, holdings, listed)) {
    const hash = await phoneSend(v.net, c.to, c.data ?? "0x", 0n, recoverySk);
    await waitReceipt(v.net, hash);
    out.push(hash);
  }
  return out;
}
export { safeTxHash, execTransactionData };

// ---------- "I started this" and the check on every app open ----------

const STARTED = "w.ethstarted";
async function startedSet(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse((await getItem(STARTED)) ?? "[]"));
  } catch {
    return new Set();
  }
}
async function rememberStarted(
  net: VaultNet,
  logs: { address: Hex; topics: Hex[]; data: Hex }[],
) {
  const s = await startedSet();
  for (const ev of parseEventLogs({
    abi: ABI.delay,
    eventName: "TransactionAdded",
    logs: logs as never,
  }))
    s.add(startedKey(net, (ev.args as { queueNonce: bigint }).queueNonce));
  await setItem(STARTED, JSON.stringify([...s].slice(-300)));
}

export const ethAlertList = store<EthAlert[]>([]);

/** Reads every vault's live configuration and queue; run on every app open and by the background task. */
export async function checkEthVaults(): Promise<EthAlert[]> {
  await loadVaults();
  const started = await startedSet();
  const all: EthAlert[] = [];
  for (const n of NETS) {
    const v = vaults.get()[n];
    if (!v || v.state !== "live") continue;
    try {
      const e = await expectedFor(v);
      const live = await readLive(reader(n), e);
      const items = await queuedItems(v, e, live);
      all.push(
        ...ethAlerts(
          n,
          VAULT_NETS[n].label,
          live,
          e,
          items,
          started,
          Math.floor(Date.now() / 1000),
          tokensOn(n),
        ),
      );
    } catch (err) {
      all.push({
        key: `eth:${n}:unreachable`,
        net: n,
        kind: "config",
        level: "warn",
        text: `${VAULT_NETS[n].label}: could not read your vault (${(err as Error).message}). It was not checked.`,
      });
    }
  }
  ethAlertList.set(all);
  return all;
}
export { DEFAULT_WAIT };
