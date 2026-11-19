// Copied from the website (app/src/lib/btc.ts) so phone and website build identical swap contracts.
// bitcoin side of a swap: a P2WSH hash-time-locked contract.
//
//   OP_IF
//     OP_SIZE 32 OP_EQUALVERIFY OP_SHA256 <hashlock> OP_EQUALVERIFY <claim pubkey>
//   OP_ELSE
//     <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP <refund pubkey>
//   OP_ENDIF
//   OP_CHECKSIG
//
// The OP_SIZE check pins the secret to 32 bytes, same as LOKYX requires. Without it, a secret of
// a different length could be valid on one chain and not the other.

import { Script, Transaction, OutScript, p2wsh, SigHash, NETWORK, TEST_NETWORK, Address } from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';

/** Bitcoin networks a swap can use. The website swaps on testnet4; phone-to-phone can also use signet. */
export type BtcNet = 'testnet4' | 'signet' | 'mainnet' | 'regtest';

export function network(n: BtcNet) {
  if (n === 'mainnet') return NETWORK;
  if (n === 'regtest') return { ...TEST_NETWORK, bech32: 'bcrt' };
  return TEST_NETWORK;
}

export interface Htlc {
  hashlock: Uint8Array;
  claimPub: Uint8Array;
  refundPub: Uint8Array;
  /** Absolute bitcoin block height from which the refund path works. */
  locktime: number;
}

export function htlcScript(h: Htlc): Uint8Array {
  if (h.hashlock.length !== 32) throw new Error('hashlock must be 32 bytes');
  for (const k of [h.claimPub, h.refundPub]) if (k.length !== 33) throw new Error('pubkeys must be compressed');
  if (!Number.isInteger(h.locktime) || h.locktime <= 0 || h.locktime >= 500_000_000) throw new Error('locktime must be a block height');
  return Script.encode([
    'IF',
    'SIZE', 32, 'EQUALVERIFY', 'SHA256', h.hashlock, 'EQUALVERIFY', h.claimPub,
    'ELSE',
    h.locktime, 'CHECKLOCKTIMEVERIFY', 'DROP', h.refundPub,
    'ENDIF',
    'CHECKSIG',
  ]);
}

export function htlcAddress(h: Htlc, n: BtcNet): string {
  return p2wsh({ type: 'wsh', script: htlcScript(h) } as never, network(n)).address!;
}

export function isBtcAddress(a: string, n: BtcNet): boolean {
  try {
    Address(network(n)).decode(a.trim());
    return true;
  } catch {
    return false;
  }
}

/** Per-swap bitcoin key, derived from the LOKYX key so it can always be recreated. */
export function swapBtcKey(lokyxKey: Uint8Array, salt: string, purpose: 'claim' | 'refund'): Uint8Array {
  for (let i = 0; ; i++) {
    const k = hmac(sha256, lokyxKey, utf8ToBytes(`LOKYX/swap/btc/${purpose}/${salt}/${i}`));
    if (secp256k1.utils.isValidSecretKey(k)) return k;
  }
}

/** The swap secret, also derived (never stored), and its sha256 hashlock. */
export function swapSecret(lokyxKey: Uint8Array, salt: string): Uint8Array {
  return hmac(sha256, lokyxKey, utf8ToBytes(`LOKYX/swap/secret/${salt}`));
}

export const pubOf = (sk: Uint8Array) => secp256k1.getPublicKey(sk, true);
export const hashlockOf = (secret: Uint8Array) => sha256(secret);

export interface Utxo {
  txid: string;
  vout: number;
  value: number; // sats
}

/** vsize of a claim (~153 vB) or refund (~145 vB); rounded up a little. */
const CLAIM_VBYTES = 160;
const REFUND_VBYTES = 150;
export const DUST = 330;

function spend(
  h: Htlc,
  utxo: Utxo,
  to: string,
  feeRate: number,
  n: BtcNet,
  sk: Uint8Array,
  path: 'claim' | 'refund',
  secret?: Uint8Array,
): { hex: string; txid: string; fee: number } {
  const script = htlcScript(h);
  const fee = Math.ceil(feeRate * (path === 'claim' ? CLAIM_VBYTES : REFUND_VBYTES));
  const out = utxo.value - fee;
  if (out < DUST) throw new Error('The locked amount is too small to cover the bitcoin fee');
  const tx = new Transaction({
    allowUnknownOutputs: false,
    lockTime: path === 'refund' ? h.locktime : 0,
  });
  tx.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: { script: OutScript.encode({ type: 'wsh', hash: sha256(script) }), amount: BigInt(utxo.value) },
    witnessScript: script,
    // non-final sequence so CHECKLOCKTIMEVERIFY is enforced on the refund path
    sequence: 0xfffffffe,
  });
  tx.addOutputAddress(to.trim(), BigInt(out), network(n));
  tx.signIdx(sk, 0, [SigHash.ALL]);
  const sig = tx.getInput(0).partialSig?.[0]?.[1];
  if (!sig) throw new Error('Signing failed');
  const witness = path === 'claim' ? [sig, secret!, Uint8Array.of(1), script] : [sig, new Uint8Array(), script];
  tx.updateInput(0, { finalScriptWitness: witness }, true);
  return { hex: tx.hex, txid: tx.id, fee };
}

export function buildClaim(h: Htlc, utxo: Utxo, secret: Uint8Array, claimKey: Uint8Array, to: string, feeRate: number, n: BtcNet) {
  if (bytesToHex(sha256(secret)) !== bytesToHex(h.hashlock)) throw new Error('Secret does not match the hashlock');
  return spend(h, utxo, to, feeRate, n, claimKey, 'claim', secret);
}

export function buildRefund(h: Htlc, utxo: Utxo, refundKey: Uint8Array, to: string, feeRate: number, n: BtcNet) {
  return spend(h, utxo, to, feeRate, n, refundKey, 'refund');
}

/** If `witness` (hex items, as esplora returns them) is a claim of this HTLC, return the secret. */
export function secretFromWitness(witness: string[] | undefined, hashlock: Uint8Array): Uint8Array | null {
  if (!witness || witness.length !== 4) return null;
  const s = hexToBytes(witness[1]);
  return s.length === 32 && bytesToHex(sha256(s)) === bytesToHex(hashlock) ? s : null;
}

// ---------- esplora (mempool.space style) API ----------

export const DEFAULT_BTC_API: Record<BtcNet, string> = {
  testnet4: 'https://mempool.space/testnet4/api',
  signet: 'https://mempool.space/signet/api',
  mainnet: 'https://mempool.space/api',
  regtest: 'http://127.0.0.1:3002',
};

interface EsploraTx {
  txid: string;
  status: { confirmed: boolean; block_height?: number };
  vin: { txid: string; vout: number; witness?: string[] }[];
  vout: { scriptpubkey_address?: string; value: number }[];
}

async function get<T>(api: string, path: string): Promise<T> {
  const r = await fetch(api + path);
  if (!r.ok) throw new Error(`Bitcoin API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (path.endsWith('/height') ? Number(await r.text()) : await r.json()) as T;
}

export const tipHeight = (api: string) => get<number>(api, '/blocks/tip/height');

export async function broadcast(api: string, hex: string): Promise<string> {
  const r = await fetch(api + '/tx', { method: 'POST', body: hex });
  const t = await r.text();
  if (!r.ok) throw new Error(`Bitcoin network refused it: ${t.slice(0, 300)}`);
  return t.trim();
}

export interface HtlcState {
  /** Outputs paying the HTLC address. */
  funding: (Utxo & { confirmations: number; spent: boolean })[];
  /** Total sats paid in (confirmed or not). */
  received: number;
  /** A spend of the HTLC: claim (with the secret) or refund. */
  spend?: { txid: string; secret: Uint8Array | null; confirmations: number };
  tip: number;
}

export async function watchHtlc(api: string, address: string, hashlock: Uint8Array): Promise<HtlcState> {
  const [tip, txs] = await Promise.all([tipHeight(api), get<EsploraTx[]>(api, `/address/${address}/txs`)]);
  const conf = (t: EsploraTx) => (t.status.confirmed && t.status.block_height ? tip - t.status.block_height + 1 : 0);
  const funding: HtlcState['funding'] = [];
  let spend: HtlcState['spend'];
  for (const t of txs) {
    t.vout.forEach((o, i) => {
      if (o.scriptpubkey_address === address) funding.push({ txid: t.txid, vout: i, value: o.value, confirmations: conf(t), spent: false });
    });
  }
  for (const t of txs) {
    for (const i of t.vin) {
      const f = funding.find((f) => f.txid === i.txid && f.vout === i.vout);
      if (f) {
        f.spent = true;
        const secret = secretFromWitness(i.witness, hashlock);
        // a claim (with the secret) wins over a refund if both somehow show up
        if (!spend || (secret && !spend.secret)) spend = { txid: t.txid, secret, confirmations: conf(t) };
      }
    }
  }
  return { funding, received: funding.reduce((s, f) => s + f.value, 0), spend, tip };
}

export { bytesToHex, hexToBytes, concatBytes };
