// Tron from the same 24 words. Pure functions (no network, no phone APIs), tested in test/sol-tron.test.ts.
//
//   Key      BIP44 secp256k1, m/44'/195'/0'/0/i  (the path TronLink uses)
//   Address  0x41 + last 20 bytes of keccak256(public key), in base58check: T…
//   Send     the TransferContract transaction is built here, byte for byte (protobuf), so the node that relays it
//            cannot change what is signed. The node only supplies a recent block to anchor it to.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base58check } from '@scure/base';
import type { HDKey } from '@scure/bip32';

export type TronNet = 'nile' | 'shasta' | 'mainnet';
export const TRON_NETS: Record<TronNet, { label: string; short: string; unit: string; real: boolean; api: string; explorer: string }> = {
  nile: { label: 'Tron Nile testnet', short: 'Nile', unit: 'TRX', real: false, api: 'https://nile.trongrid.io', explorer: 'https://nile.tronscan.org/#' },
  shasta: { label: 'Tron Shasta testnet', short: 'Shasta', unit: 'TRX', real: false, api: 'https://api.shasta.trongrid.io', explorer: 'https://shasta.tronscan.org/#' },
  mainnet: { label: 'Tron', short: 'Mainnet', unit: 'TRX', real: true, api: 'https://api.trongrid.io', explorer: 'https://tronscan.org/#' },
};

export const SUN = 1_000_000n;
export const TRX_DECIMALS = 6;
export const tronPath = (i: number) => `m/44'/195'/0'/0/${i}`;

const b58c = base58check(sha256);

export function tronAddressFromPub(pub: Uint8Array): string {
  const full = pub.length === 65 ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
  const h = keccak_256(full.slice(1));
  return b58c.encode(concatBytes(Uint8Array.of(0x41), h.slice(-20)));
}

export function tronKey(root: HDKey, i = 0): { sk: Uint8Array; address: string } {
  const k = root.derive(tronPath(i));
  if (!k.privateKey || !k.publicKey) throw new Error('Key derivation failed');
  return { sk: k.privateKey, address: tronAddressFromPub(k.publicKey) };
}

/** The 21 address bytes (0x41…) of a T… address, or null. */
export function tronBytes(a: string): Uint8Array | null {
  try {
    const b = b58c.decode(a.trim());
    return b.length === 21 && b[0] === 0x41 ? b : null;
  } catch {
    return null;
  }
}
export const tronAddressOk = (a: string) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a.trim()) && tronBytes(a) !== null;
export const tronHex = (a: string) => bytesToHex(tronBytes(a) ?? new Uint8Array());
export const tronFromHex = (h: string) => b58c.encode(hexToBytes(h.replace(/^0x/, '')));

// ---------- protobuf, only what a TransferContract needs ----------

function varint(n: bigint): Uint8Array {
  const out: number[] = [];
  let v = n;
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return Uint8Array.from(out);
}
const tag = (field: number, wire: number) => varint(BigInt((field << 3) | wire));
const fBytes = (field: number, b: Uint8Array) => concatBytes(tag(field, 2), varint(BigInt(b.length)), b);
const fInt = (field: number, n: bigint) => concatBytes(tag(field, 0), varint(n));

export interface TronBlockRef {
  /** the block number */
  number: number;
  /** blockID, hex */
  id: string;
  /** block time, ms */
  timestamp: number;
}

/** The raw transaction (the bytes whose sha256 is the id and is what gets signed). */
export function transferRaw(from: string, to: string, sun: bigint, ref: TronBlockRef, now: number): Uint8Array {
  const f = tronBytes(from);
  const t = tronBytes(to);
  if (!f || !t) throw new Error('Not a Tron address');
  if (from === to) throw new Error('That is your own address');
  if (sun <= 0n) throw new Error('Enter an amount');
  const id = hexToBytes(ref.id);
  if (id.length !== 32) throw new Error('Bad block reference');
  const num = new Uint8Array(8);
  new DataView(num.buffer).setBigUint64(0, BigInt(ref.number));
  const transfer = concatBytes(fBytes(1, f), fBytes(2, t), fInt(3, sun));
  const any = concatBytes(fBytes(1, utf8ToBytes('type.googleapis.com/protocol.TransferContract')), fBytes(2, transfer));
  const contract = concatBytes(fInt(1, 1n), fBytes(2, any)); // type 1 = TransferContract
  return concatBytes(
    fBytes(1, num.slice(6, 8)), // ref_block_bytes
    fBytes(4, id.slice(8, 16)), // ref_block_hash
    fInt(8, BigInt(ref.timestamp + 10 * 60_000)), // expiration: ten minutes after the reference block
    fBytes(11, contract),
    fInt(14, BigInt(now)),
  );
}

/** A signed transfer: its id and the whole transaction as hex, for /wallet/broadcasthex. */
export function signTronTransfer(sk: Uint8Array, from: string, to: string, sun: bigint, ref: TronBlockRef, now: number): { id: string; hex: string } {
  if (tronAddressFromPub(secp256k1.getPublicKey(sk, false)) !== from) throw new Error('This key is not for that address');
  const raw = transferRaw(from, to, sun, ref, now);
  const id = sha256(raw);
  const rec = secp256k1.sign(id, sk, { prehash: false, format: 'recovered' });
  // noble's recovered format is [recovery, r, s]; Tron wants r || s || (27 + recovery)
  const sig = concatBytes(rec.slice(1, 65), Uint8Array.of(27 + rec[0]));
  return { id: bytesToHex(id), hex: bytesToHex(concatBytes(fBytes(1, raw), fBytes(2, sig))) };
}

export function parseTrx(s: string): bigint {
  const t = s.trim();
  if (!/^\d*\.?\d+$/.test(t) && !/^\d+\.$/.test(t)) throw new Error('Enter an amount like 10');
  const [w, d = ''] = t.split('.');
  if (d.length > TRX_DECIMALS) throw new Error('TRX has at most 6 decimals');
  return BigInt(w || '0') * SUN + BigInt((d + '0'.repeat(TRX_DECIMALS)).slice(0, TRX_DECIMALS));
}

export interface TronTxRow {
  id: string;
  time?: number;
  delta: bigint;
  failed: boolean;
  other: string;
}

/** TRX transfers from TronGrid's /v1/accounts/{a}/transactions. Other kinds of transaction are left out. */
export function parseTronTxs(j: unknown, address: string): TronTxRow[] {
  const me = tronHex(address).toLowerCase();
  const data = (j as { data?: unknown[] })?.data ?? [];
  const out: TronTxRow[] = [];
  for (const x of data as { txID?: string; block_timestamp?: number; ret?: { contractRet?: string }[]; raw_data?: { contract?: { type?: string; parameter?: { value?: { owner_address?: string; to_address?: string; amount?: number } } }[] } }[]) {
    const c = x.raw_data?.contract?.[0];
    if (!x.txID || c?.type !== 'TransferContract' || !c.parameter?.value) continue;
    const v = c.parameter.value;
    const from = (v.owner_address ?? '').toLowerCase();
    const to = (v.to_address ?? '').toLowerCase();
    const amt = BigInt(v.amount ?? 0);
    const failed = !!x.ret?.[0]?.contractRet && x.ret[0].contractRet !== 'SUCCESS';
    if (from === me) out.push({ id: x.txID, time: x.block_timestamp ? Math.floor(x.block_timestamp / 1000) : undefined, delta: -amt, failed, other: safeAddr(to) });
    else if (to === me) out.push({ id: x.txID, time: x.block_timestamp ? Math.floor(x.block_timestamp / 1000) : undefined, delta: amt, failed, other: safeAddr(from) });
  }
  return out;
}
const safeAddr = (h: string) => {
  try {
    return tronFromHex(h);
  } catch {
    return h;
  }
};
