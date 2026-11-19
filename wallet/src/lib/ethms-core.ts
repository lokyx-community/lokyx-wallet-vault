// Shared Ethereum accounts on Safe v1.4.1 (the same official contracts the ETH vault uses). Owners are each
// person's own Ethereum address; a payment travels between phones as a lokyx-eth-safe: code carrying the Safe
// transaction and the signatures so far. Whoever adds the last one sends it. Pure, so it is tested.

import { concat, decodeFunctionData, encodeFunctionData, encodePacked, getAddress, getCreate2Address, hexToBigInt, keccak256, pad, recoverAddress, toHex, zeroAddress, type Hex } from 'viem';
import { ABI, SAFE_PROXY_CREATION_CODE, deploymentOf, safeTxHash, signHash, type SafeTx } from './ethvault-core.ts';
import { ETH_NETS, type EthNet } from './multichain-core.ts';

export const CODE_PREFIX = 'lokyx-eth-safe:';

export interface EthShared {
  name: string;
  chainId: number;
  owners: Hex[];
  threshold: number;
}

export const sortOwners = (o: string[]) => [...o].map((a) => getAddress(a)).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));

export function checkShared(s: Pick<EthShared, 'owners' | 'threshold'>) {
  const o = sortOwners(s.owners);
  if (new Set(o).size !== o.length) throw new Error('The same address is in the list twice');
  if (o.length < 2 || o.length > 10) throw new Error('Between 2 and 10 people');
  if (s.threshold < 1 || s.threshold > o.length) throw new Error('Pick between 1 and the number of people');
  return o;
}

const initializer = (s: Pick<EthShared, 'owners' | 'threshold'>): Hex =>
  encodeFunctionData({ abi: ABI.safe, functionName: 'setup', args: [checkShared(s), BigInt(s.threshold), zeroAddress, '0x', deploymentOf().fallbackHandler, zeroAddress, 0n, zeroAddress] });
const salt = (s: Pick<EthShared, 'owners' | 'threshold'>) => hexToBigInt(keccak256(encodePacked(['string', 'address[]', 'uint256'], ['LOKYX shared v1', checkShared(s), BigInt(s.threshold)])));

/** The account's address, the same on every phone and every network (it only exists where it was created). */
export function sharedAddress(s: Pick<EthShared, 'owners' | 'threshold'>): Hex {
  const d = deploymentOf();
  const init = initializer(s);
  const sl = keccak256(concat([keccak256(init), pad(toHex(salt(s)), { size: 32 })]));
  return getCreate2Address({ from: d.safeProxyFactory, salt: sl, bytecodeHash: keccak256(concat([SAFE_PROXY_CREATION_CODE, pad(d.safeSingleton, { size: 32 })])) });
}

/** The transaction that creates it: a call to Safe's proxy factory. Anyone can send it. */
export const createCall = (s: Pick<EthShared, 'owners' | 'threshold'>) => ({
  to: deploymentOf().safeProxyFactory,
  data: encodeFunctionData({ abi: ABI.factory, functionName: 'createProxyWithNonce', args: [deploymentOf().safeSingleton, initializer(s), salt(s)] }),
});

export interface Pay {
  chainId: number;
  safe: Hex;
  to: Hex;
  /** wei */
  value: string;
  nonce: string;
  /** owner address -> 65-byte signature */
  sigs: Record<string, Hex>;
  /** What the call carries. Missing or '0x' is a plain coin payment; a token payment carries an ERC-20 transfer. */
  data?: Hex;
}

const tx = (p: Pay): SafeTx => ({ to: getAddress(p.to), value: BigInt(p.value), data: p.data ?? '0x', operation: 0, nonce: BigInt(p.nonce) });
export const payHash = (p: Pay) => safeTxHash(p.chainId, getAddress(p.safe), tx(p));
export const encodePay = (p: Pay) => CODE_PREFIX + btoa(JSON.stringify(p));
export function decodePay(code: string): Pay {
  const c = code.trim();
  if (!c.startsWith(CODE_PREFIX)) throw new Error("That isn't a shared Ethereum payment code");
  try {
    return JSON.parse(atob(c.slice(CODE_PREFIX.length))) as Pay;
  } catch {
    throw new Error('The payment code is damaged. Copy it again.');
  }
}

/** Signatures that really come from owners of this account (a forged or stray one is dropped). */
export async function validSigners(p: Pay, owners: string[]): Promise<Hex[]> {
  const hash = payHash(p);
  const own = new Set(owners.map((o) => o.toLowerCase()));
  const out: Hex[] = [];
  for (const [who, sig] of Object.entries(p.sigs)) {
    try {
      const r = await recoverAddress({ hash, signature: sig });
      if (r.toLowerCase() === who.toLowerCase() && own.has(r.toLowerCase())) out.push(getAddress(r));
    } catch {
      /* not a signature */
    }
  }
  return out;
}

export async function addSignature(p: Pay, sk: Hex, me: Hex): Promise<Pay> {
  return { ...p, sigs: { ...p.sigs, [getAddress(me)]: await signHash(sk, payHash(p)) } };
}

/** execTransaction data with the signatures in owner order, as Safe requires. */
export async function execData(p: Pay, owners: string[], threshold: number): Promise<{ to: Hex; data: Hex }> {
  const good = (await validSigners(p, owners)).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)).slice(0, threshold);
  if (good.length < threshold) throw new Error(`It needs ${threshold - good.length} more signature${threshold - good.length === 1 ? '' : 's'}`);
  const signature = concat(good.map((a) => p.sigs[a] ?? p.sigs[a.toLowerCase()] ?? Object.entries(p.sigs).find(([k]) => k.toLowerCase() === a.toLowerCase())![1]));
  return { to: getAddress(p.safe), data: encodeFunctionData({ abi: ABI.safe, functionName: 'execTransaction', args: [tx(p).to, tx(p).value, tx(p).data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature] }) };
}

// ---------- any network, any token ----------

/** The network a saved account lives on, from its chain id. */
export const netOfChainId = (chainId: number): EthNet | null => (Object.keys(ETH_NETS) as EthNet[]).find((n) => ETH_NETS[n].chainId === chainId) ?? null;

/** A payment of a token: the Safe calls the token's transfer(to, amount). Nothing else is ever built here. */
export function tokenPay(base: Pick<Pay, 'chainId' | 'safe' | 'nonce'>, token: string, to: string, amount: bigint): Pay {
  if (amount <= 0n) throw new Error('The amount must be more than zero');
  return { ...base, to: getAddress(token), value: '0', data: encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [getAddress(to), amount] }), sigs: {} };
}

/** What signing a payment really does, read from the bytes that get signed. */
export type PayView =
  | { kind: 'coin'; to: Hex; value: bigint }
  | { kind: 'token'; token: Hex; to: Hex; amount: bigint }
  | { kind: 'other'; to: Hex; value: bigint; data: Hex };

export function describePay(p: Pay): PayView {
  const to = getAddress(p.to);
  const value = BigInt(p.value);
  const data = p.data ?? '0x';
  if (data === '0x') return { kind: 'coin', to, value };
  if (value === 0n) {
    try {
      const d = decodeFunctionData({ abi: ABI.erc20, data });
      if (d.functionName === 'transfer') {
        const [dest, amount] = d.args as readonly [Hex, bigint];
        // it must re-encode to exactly these bytes, so nothing hides in extra trailing data
        if (encodeFunctionData({ abi: ABI.erc20, functionName: 'transfer', args: [dest, amount] }).toLowerCase() === data.toLowerCase()) return { kind: 'token', token: to, to: getAddress(dest), amount };
      }
    } catch {
      /* not an ERC-20 transfer */
    }
  }
  return { kind: 'other', to, value, data };
}

/** A payment code from someone else is only signed when it is a plain coin or token payment. */
export function assertSignable(p: Pay): PayView {
  const v = describePay(p);
  if (v.kind === 'other') throw new Error('This payment does something other than send a coin or a token, so this app will not sign it.');
  return v;
}

export interface Pending {
  code: string;
  hash: string;
  /** signatures on it so far (counted, not yet checked: the screen checks them against the owners) */
  sigs: number;
}

/**
 * Out of everything the relay holds for a group, the payments still waiting on this account. Wrong account or network,
 * a payment that is not a plain coin or token transfer, one already used up (its nonce is behind the account's) and any the
 * person dismissed are dropped. Copies of one payment are merged into one with every signature seen.
 */
export function pendingPays(codes: string[], safe: string, chainId: number, nonce: bigint | undefined, gone: ReadonlySet<string>): Pending[] {
  const best = new Map<string, { p: Pay; at: number }>();
  codes.forEach((code, at) => {
    try {
      const p = decodePay(code);
      if (p.chainId !== chainId || getAddress(p.safe) !== getAddress(safe)) return;
      if (nonce !== undefined && BigInt(p.nonce) < nonce) return;
      assertSignable(p);
      const hash = payHash(p);
      if (gone.has(hash)) return;
      const cur = best.get(hash);
      best.set(hash, { p: cur ? { ...cur.p, sigs: { ...cur.p.sigs, ...(p.sigs ?? {}) } } : { ...p, sigs: { ...(p.sigs ?? {}) } }, at });
    } catch {
      // not a payment for this account: ignore it
    }
  });
  return [...best.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .map(([hash, { p }]) => ({ code: encodePay(p), hash, sigs: Object.keys(p.sigs).length }));
}
