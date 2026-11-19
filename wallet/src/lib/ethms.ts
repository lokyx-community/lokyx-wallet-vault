// Shared Ethereum accounts on the phone: the list (public data only), creating one on chain, reading it,
// and starting, signing and sending payments. An account lives on the network it was made on, and works with
// that network's coin and any token on it.

import { decodeFunctionResult, encodeFunctionData, getAddress, parseUnits, type Hex } from 'viem';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { activeNets, ensurePrimary as ensureAddresses, ethBalance, ethCode, ethRead, lookupToken, sendEthCall, tokenBalance, tokensFor, addToken, withEthKey } from './multichain';
import { ETH_NETS, type EthNet, type EthToken } from './multichain-core';
import { ABI, deploymentOf } from './ethvault-core';
import { pendingPays, type Pending } from './ethms-core';
import { goneSet, allFromGroup } from './relay';
import { newGroupKey } from './relay-seal';
import { addSignature, assertSignable, createCall, execData, netOfChainId, sharedAddress, tokenPay, type EthShared, type Pay } from './ethms-core';

export interface EthSharedSaved extends EthShared {
  address: Hex;
  at: number;
  /** the group key for automatic approvals through the relay; accounts made before it have none and keep using codes */
  relay?: string;
}
export const ethShared = store<EthSharedSaved[]>([]);
export const useEthShared = () => useStore(ethShared);
export async function loadEthShared() {
  try {
    ethShared.set(JSON.parse((await getItem('w.ethms')) ?? '[]'));
  } catch {}
}
async function save(list: EthSharedSaved[]) {
  ethShared.set(list);
  await setItem('w.ethms', JSON.stringify(list));
}

/** The network an account lives on. Never the one the wallet happens to be showing. */
export function netOf(s: Pick<EthShared, 'chainId'>): EthNet {
  const n = netOfChainId(s.chainId);
  if (!n) throw new Error('This account is on a network this version does not know');
  return n;
}

/** Safe's contracts must be on the network before anything is created there; otherwise the fee would be wasted. */
export async function safeReady(net: EthNet): Promise<boolean> {
  const d = deploymentOf();
  const [factory, single] = await Promise.all([ethCode(net, d.safeProxyFactory), ethCode(net, d.safeSingleton)]);
  return factory !== '0x' && single !== '0x';
}

/** Remember it, and create it on chain if nobody has yet (you pay the gas). */
export async function addEthShared(name: string, owners: string[], threshold: number, create: boolean, net: EthNet = activeNets().eth, relayKey?: string): Promise<EthSharedSaved> {
  const s: EthShared = { name: name.trim() || 'Shared account', chainId: ETH_NETS[net].chainId, owners: owners.map((o) => getAddress(o)), threshold };
  const address = sharedAddress(s);
  if (create) {
    if (!(await safeReady(net))) throw new Error(`Safe is not on ${ETH_NETS[net].label} yet, so a shared account cannot be made there`);
    if ((await ethCode(net, address)) === '0x') {
      const c = createCall(s);
      await sendEthCall(c.to, c.data, 0n, net);
    }
  }
  const before = ethShared.get().find((x) => x.address === address && x.chainId === s.chainId);
  const relay = relayKey?.trim() || before?.relay || (create ? newGroupKey() : undefined);
  const item = { ...s, address, at: Date.now(), ...(relay ? { relay } : {}) };
  await save([item, ...ethShared.get().filter((x) => x.address !== address || x.chainId !== s.chainId)]);
  return item;
}
export const removeEthShared = (address: string, chainId?: number) => save(ethShared.get().filter((x) => !(x.address.toLowerCase() === address.toLowerCase() && (chainId == null || x.chainId === chainId))));

export async function readEthShared(s: EthSharedSaved) {
  const net = netOf(s);
  if ((await ethCode(net, s.address)) === '0x') return { exists: false, balance: 0n, nonce: 0n };
  const [bal, nonceHex] = await Promise.all([ethBalance(net, s.address), ethRead(net, s.address, encodeFunctionData({ abi: ABI.safe, functionName: 'nonce' }))]);
  return { exists: true, balance: bal, nonce: decodeFunctionResult({ abi: ABI.safe, functionName: 'nonce', data: nonceHex }) as bigint };
}

/** Tokens the person added on this account's network, with what the account holds of each. */
export async function readSharedTokens(s: EthSharedSaved): Promise<{ token: EthToken; balance: bigint }[]> {
  const net = netOf(s);
  const list = tokensFor(net);
  const out = await Promise.all(list.map(async (token) => ({ token, balance: await tokenBalance(net, token, s.address).catch(() => 0n) })));
  return out;
}

/** Add a token by its contract address on the account's network; its name and decimals come from the chain. */
export async function addSharedToken(s: EthSharedSaved, contract: string): Promise<EthToken> {
  const net = netOf(s);
  const t = await lookupToken(net, getAddress(contract.trim()));
  await addToken(t);
  return t;
}

export async function startEthPay(s: EthSharedSaved, to: string, eth: string, token?: EthToken): Promise<Pay> {
  const r = await readEthShared(s);
  if (!r.exists) throw new Error("The shared account hasn't been created on this network yet");
  const base = { chainId: s.chainId, safe: s.address, nonce: r.nonce.toString() };
  const amount = parseUnits(eth.trim(), token ? token.decimals : 18);
  const p: Pay = token
    ? tokenPay(base, token.contract, to.trim(), amount)
    : { ...base, to: getAddress(to.trim()), value: amount.toString(), sigs: {} };
  return signEthPay(s, p);
}

export async function signEthPay(s: EthSharedSaved, p: Pay): Promise<Pay> {
  if (getAddress(p.safe) !== getAddress(s.address) || p.chainId !== s.chainId) throw new Error('This payment is for a different account');
  assertSignable(p);
  const me = (await ensureAddresses()).eth;
  if (!s.owners.some((o) => o.toLowerCase() === me.toLowerCase())) throw new Error("You aren't one of this account's owners");
  return withEthKey((sk, addr) => addSignature(p, sk, addr));
}

export async function sendEthPay(s: EthSharedSaved, p: Pay): Promise<string> {
  if (p.chainId !== s.chainId) throw new Error('This payment is for a different network');
  assertSignable(p);
  const { to, data } = await execData(p, s.owners, s.threshold);
  return sendEthCall(to, data, 0n, netOf(s));
}

/** Payments the others left for this account on the relay. Empty for an account with no group key. */
export async function incomingPays(s: EthSharedSaved, nonce?: bigint): Promise<Pending[]> {
  if (!s.relay) return [];
  return pendingPays(await allFromGroup(s.relay), s.address, s.chainId, nonce, await goneSet());
}
