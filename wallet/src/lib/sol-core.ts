// Solana from the same 24 words. Pure functions (no network, no phone APIs), tested in test/sol-tron.test.ts.
//
//   Key   SLIP-0010 ed25519, m/44'/501'/0'/0'  (the path Phantom and Solflare use, so the same words show the same address there)
//   Send  a legacy transaction with one System Program transfer, signed here
//
// Only devnet and testnet for now. Mainnet sits behind the same real-money switch as Bitcoin and Ethereum.

import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';

export type SolNet = 'devnet' | 'testnet' | 'mainnet';
export const SOL_NETS: Record<SolNet, { label: string; short: string; unit: string; real: boolean; rpc: string; explorer: (kind: 'tx' | 'address', id: string) => string }> = {
  devnet: { label: 'Solana devnet', short: 'Devnet', unit: 'SOL', real: false, rpc: 'https://api.devnet.solana.com', explorer: (k, id) => `https://explorer.solana.com/${k}/${id}?cluster=devnet` },
  testnet: { label: 'Solana testnet', short: 'Testnet', unit: 'SOL', real: false, rpc: 'https://api.testnet.solana.com', explorer: (k, id) => `https://explorer.solana.com/${k}/${id}?cluster=testnet` },
  mainnet: { label: 'Solana', short: 'Mainnet', unit: 'SOL', real: true, rpc: 'https://api.mainnet-beta.solana.com', explorer: (k, id) => `https://explorer.solana.com/${k}/${id}` },
};

export const LAMPORTS = 1_000_000_000n;
export const SOL_DECIMALS = 9;
export const solPath = (i: number) => `m/44'/501'/${i}'/0'`;

const HARD = 0x80000000;

/** SLIP-0010 for ed25519: every step is hardened. */
export function solKeyFromSeed(seed: Uint8Array, i = 0): { sk: Uint8Array; address: string } {
  let I = hmac(sha512, utf8ToBytes('ed25519 seed'), seed);
  let k = I.slice(0, 32);
  let c = I.slice(32);
  for (const n of [44, 501, i, 0]) {
    const idx = new Uint8Array(4);
    new DataView(idx.buffer).setUint32(0, (n + HARD) >>> 0);
    I = hmac(sha512, c, concatBytes(Uint8Array.of(0), k, idx));
    k.fill(0);
    k = I.slice(0, 32);
    c = I.slice(32);
  }
  return { sk: k, address: base58.encode(ed25519.getPublicKey(k)) };
}

export function solAddressOk(a: string): boolean {
  const s = a.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return base58.decode(s).length === 32;
  } catch {
    return false;
  }
}

/** Solana's short length prefix ("compact-u16"). */
function shortVec(n: number): number[] {
  const out: number[] = [];
  let v = n;
  for (;;) {
    let b = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(b);
      return out;
    }
    b |= 0x80;
    out.push(b);
  }
}

const SYSTEM = new Uint8Array(32); // 11111111111111111111111111111111

/** The message a plain SOL transfer signs. */
export function transferMessage(from: string, to: string, lamports: bigint, blockhash: string): Uint8Array {
  const f = base58.decode(from);
  const t = base58.decode(to);
  const h = base58.decode(blockhash);
  if (f.length !== 32 || t.length !== 32 || h.length !== 32) throw new Error('Not a Solana address');
  if (from === to) throw new Error('That is your own address');
  if (lamports <= 0n) throw new Error('Enter an amount');
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // SystemInstruction::Transfer
  dv.setBigUint64(4, lamports, true);
  return concatBytes(
    Uint8Array.of(1, 0, 1), // one signer (from), no read-only signers, one read-only account (the System Program)
    Uint8Array.from(shortVec(3)),
    f,
    t,
    SYSTEM,
    h,
    Uint8Array.from(shortVec(1)),
    Uint8Array.of(2), // program: account 2
    Uint8Array.from(shortVec(2)),
    Uint8Array.of(0, 1),
    Uint8Array.from(shortVec(data.length)),
    data,
  );
}

/** A signed transfer, ready to send (base64), and its id (the signature, base58). */
export function signSolTransfer(sk: Uint8Array, from: string, to: string, lamports: bigint, blockhash: string): { b64: string; id: string } {
  const msg = transferMessage(from, to, lamports, blockhash);
  if (base58.encode(ed25519.getPublicKey(sk)) !== from) throw new Error('This key is not for that address');
  const sig = ed25519.sign(msg, sk);
  const tx = concatBytes(Uint8Array.from(shortVec(1)), sig, msg);
  return { b64: toB64(tx), id: base58.encode(sig) };
}

export function parseSol(s: string): bigint {
  const t = s.trim();
  if (!/^\d*\.?\d+$/.test(t) && !/^\d+\.$/.test(t)) throw new Error('Enter an amount like 0.5');
  const [w, d = ''] = t.split('.');
  if (d.length > SOL_DECIMALS) throw new Error('SOL has at most 9 decimals');
  return BigInt(w || '0') * LAMPORTS + BigInt((d + '0'.repeat(SOL_DECIMALS)).slice(0, SOL_DECIMALS));
}

/** One payment in or out, from a parsed transaction. */
export interface SolTxRow {
  id: string;
  time?: number;
  delta: bigint;
  failed: boolean;
}

/** The change to `address`'s SOL in one `getTransaction` result. The fee counts as sent. */
export function solDelta(tx: unknown, address: string): bigint | null {
  const t = tx as { meta?: { preBalances?: number[]; postBalances?: number[] }; transaction?: { message?: { accountKeys?: (string | { pubkey: string })[] } } } | null;
  const keys = t?.transaction?.message?.accountKeys ?? [];
  const i = keys.findIndex((k) => (typeof k === 'string' ? k : k.pubkey) === address);
  if (i < 0 || !t?.meta?.preBalances || !t.meta.postBalances) return null;
  return BigInt(t.meta.postBalances[i]) - BigInt(t.meta.preBalances[i]);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(b: Uint8Array): string {
  let o = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    o += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return o;
}
