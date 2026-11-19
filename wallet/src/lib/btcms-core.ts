// Shared Bitcoin accounts: an m-of-n native segwit multisig (P2WSH, keys sorted as in BIP 67). Each person
// has a multisig key from their own 24 words; payments travel between phones as partly signed transactions
// (PSBT, BIP 174) in a lokyx-btc-psbt: code. Pure, so it is tested (test/btcms.test.ts).

import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { base64 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { BTC_NETS, btcAddressOk, type BtcNet, type Utxo } from './multichain-core.ts';

export const KEY_PREFIX = 'lokyx-btckey:';
export const PSBT_PREFIX = 'lokyx-btc-psbt:';

/** BIP 48 path for a P2WSH multisig key (script type 2'). */
export const msPath = (net: BtcNet) => `m/48'/${BTC_NETS[net].coinType}'/0'/2'/0/0`;

/** Your multisig key from your words: the private key (for signing) and the public key (to share). */
export function msKey(phrase: string, net: BtcNet): { sk: Uint8Array; pub: string } {
  const k = HDKey.fromMasterSeed(mnemonicToSeedSync(phrase.trim().toLowerCase().split(/\s+/).join(' '))).derive(msPath(net));
  if (!k.privateKey || !k.publicKey) throw new Error('Key derivation failed');
  return { sk: k.privateKey, pub: bytesToHex(k.publicKey) };
}

export const parseKey = (text: string): string | null => {
  const m = text.trim().match(/(?:lokyx-btckey:)?(0[23][0-9a-f]{64})/i);
  return m ? m[1].toLowerCase() : null;
};

export interface BtcShared {
  name: string;
  net: BtcNet;
  m: number;
  /** compressed public keys, hex, sorted */
  keys: string[];
}

export const sortKeys = (keys: string[]) => [...keys].map((k) => k.toLowerCase()).sort();

function script(s: Pick<BtcShared, 'm' | 'keys' | 'net'>) {
  const keys = sortKeys(s.keys);
  if (new Set(keys).size !== keys.length) throw new Error('The same key is in the list twice');
  if (s.m < 1 || s.m > keys.length || keys.length > 15) throw new Error('Pick between 1 and the number of people');
  return btc.p2wsh(btc.p2ms(s.m, keys.map((k) => hexToBytes(k))), BTC_NETS[s.net].net);
}

/** The shared account's address. Everyone with the same keys and number gets the same one. */
export const msAddress = (s: Pick<BtcShared, 'm' | 'keys' | 'net'>) => script(s).address!;

/** Virtual size of a spend with `ins` multisig inputs and `outs` outputs (P2WSH outputs are the largest case). */
export function msVsize(m: number, n: number, ins: number, outs: number): number {
  const ws = 3 + 34 * n; // m <keys> n CHECKMULTISIG
  const witness = 1 + 1 + m * 73 + 1 + ws; // item count, empty dummy, signatures, script
  const inWeight = (32 + 4 + 1 + 4) * 4 + witness;
  return Math.ceil((10.5 * 4 + ins * inWeight + outs * 43 * 4) / 4);
}

export interface Draft {
  psbt: string;
  amount: bigint;
  fee: bigint;
  change: bigint;
}

/** A payment out of the shared account, not signed by anyone yet. All coins are spent; change comes back. */
export function draftSpend(s: BtcShared, utxos: Utxo[], to: string, amount: bigint, rate: number): Draft {
  if (!btcAddressOk(to, s.net)) throw new Error(`That is not a valid ${BTC_NETS[s.net].label} address.`);
  const p = script(s);
  const n = BTC_NETS[s.net].net;
  const total = utxos.reduce((a, u) => a + u.value, 0n);
  const feeWith = BigInt(Math.ceil(msVsize(s.m, s.keys.length, utxos.length, 2) * rate));
  const feeWithout = BigInt(Math.ceil(msVsize(s.m, s.keys.length, utxos.length, 1) * rate));
  if (amount < 330n) throw new Error('That amount is below what Bitcoin relays');
  let fee = feeWith;
  let change = total - amount - feeWith;
  if (change < 330n) {
    fee = total - amount;
    change = 0n;
    if (fee < feeWithout) throw new Error("The shared account doesn't hold enough for that and the network fee.");
  }
  const tx = new btc.Transaction();
  for (const u of utxos) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: p.script, amount: u.value }, witnessScript: p.witnessScript });
  tx.addOutputAddress(to.trim(), amount, n);
  if (change > 0n) tx.addOutputAddress(p.address!, change, n);
  return { psbt: PSBT_PREFIX + base64.encode(tx.toPSBT()), amount, fee, change };
}

export interface Reading {
  /** where the money goes, leaving out change back to the account */
  pays: { to: string; amount: bigint }[];
  fee: bigint;
  signatures: number;
  needed: number;
  signedByKey: (pub: string) => boolean;
  ready: boolean;
}

const load = (code: string) => {
  const c = code.trim();
  if (!c.startsWith(PSBT_PREFIX)) throw new Error("That isn't a shared Bitcoin payment code");
  return btc.Transaction.fromPSBT(base64.decode(c.slice(PSBT_PREFIX.length)));
};

/** What a payment code says, checked against the shared account it claims to spend from. */
export function readSpend(s: BtcShared, code: string): Reading {
  const tx = load(code);
  const p = script(s);
  const n = BTC_NETS[s.net].net;
  let inSum = 0n;
  let sigs = Infinity;
  const signers = new Set<string>();
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    if (!inp.witnessUtxo || bytesToHex(inp.witnessUtxo.script) !== bytesToHex(p.script)) throw new Error('This payment spends from a different account');
    inSum += inp.witnessUtxo.amount;
    const ps = inp.partialSig ?? [];
    sigs = Math.min(sigs, ps.length);
    if (i === 0) ps.forEach(([pub]) => signers.add(bytesToHex(pub)));
  }
  let outSum = 0n;
  const pays: Reading['pays'] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    const addr = btc.Address(n).encode(btc.OutScript.decode(o.script!));
    outSum += o.amount!;
    if (addr !== p.address) pays.push({ to: addr, amount: o.amount! });
  }
  const signatures = sigs === Infinity ? 0 : sigs;
  return { pays, fee: inSum - outSum, signatures, needed: s.m, signedByKey: (pub) => signers.has(pub.toLowerCase()), ready: signatures >= s.m };
}

/** Add your signature. Returns the new code, to send to the next person or to finish. */
export function signSpend(s: BtcShared, code: string, sk: Uint8Array): string {
  readSpend(s, code); // refuses a code for another account
  const tx = load(code);
  tx.sign(sk);
  return PSBT_PREFIX + base64.encode(tx.toPSBT());
}

/** With enough signatures: the raw transaction to broadcast. */
export function finishSpend(s: BtcShared, code: string): { hex: string; txid: string } {
  const r = readSpend(s, code);
  if (!r.ready) throw new Error(`It needs ${r.needed - r.signatures} more signature${r.needed - r.signatures === 1 ? '' : 's'}`);
  const tx = load(code);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id };
}
