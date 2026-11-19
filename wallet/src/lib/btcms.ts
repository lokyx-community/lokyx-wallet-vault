// Shared Bitcoin accounts on the phone: the list (kept in plain storage: only public keys), your own
// multisig key from your words, balances, and broadcasting a finished payment.

import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { readPhrase } from './wallet';
import { btcBalance, btcRates, btcUtxos, broadcastBtc } from './multichain';
import { draftSpend, finishSpend, msAddress, msKey, readSpend, signSpend, type BtcShared, type Reading } from './btcms-core';
import { allFromGroup, goneSet } from './relay';
import { newGroupKey } from './relay-seal';
import type { BtcNet } from './multichain-core';

export interface BtcSharedSaved extends BtcShared {
  address: string;
  at: number;
  /** the group key for automatic approvals through the relay; accounts made before it have none and keep using codes */
  relay?: string;
}
export const btcShared = store<BtcSharedSaved[]>([]);
export const useBtcShared = () => useStore(btcShared);
export async function loadBtcShared() {
  try {
    btcShared.set(JSON.parse((await getItem('w.btcms')) ?? '[]'));
  } catch {}
}
async function save(list: BtcSharedSaved[]) {
  btcShared.set(list);
  await setItem('w.btcms', JSON.stringify(list));
}

/** Your public multisig key for this network, to give to the others. */
export async function myMsPub(net: BtcNet): Promise<string> {
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = msKey(phrase, net);
  k.sk.fill(0);
  return k.pub;
}

export async function addBtcShared(s: BtcShared, relayKey?: string): Promise<BtcSharedSaved> {
  const address = msAddress(s);
  const relay = relayKey?.trim() || btcShared.get().find((x) => x.address === address)?.relay || newGroupKey();
  const item = { ...s, address, at: Date.now(), relay };
  await save([item, ...btcShared.get().filter((x) => x.address !== address)]);
  return item;
}
export const removeBtcShared = (address: string) => save(btcShared.get().filter((x) => x.address !== address));

export async function sharedBalance(s: BtcSharedSaved) {
  const b = await btcBalance(s.net, s.address);
  return b.confirmed + b.pending;
}

/** Start a payment and sign it with your key. Returns the code to send to the next person. */
export async function startPayment(s: BtcSharedSaved, to: string, amount: bigint) {
  const [utxos, rates] = await Promise.all([btcUtxos(s.net, s.address), btcRates(s.net)]);
  if (!utxos.length) throw new Error('The shared account is empty');
  const d = draftSpend(s, utxos, to, amount, rates.normal);
  return { ...d, psbt: await signWithMine(s, d.psbt) };
}

export async function signWithMine(s: BtcShared, code: string): Promise<string> {
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = msKey(phrase, s.net);
  try {
    if (!s.keys.map((x) => x.toLowerCase()).includes(k.pub)) throw new Error("Your key isn't one of this account's keys");
    return signSpend(s, code, k.sk);
  } finally {
    k.sk.fill(0);
  }
}

export async function sendFinished(s: BtcShared, code: string): Promise<string> {
  const { hex } = finishSpend(s, code);
  return broadcastBtc(s.net, hex);
}

/** What identifies one payment, the same on every copy however many signatures it has: where it goes and the fee. */
export const spendId = (address: string, r: Reading): string => `${address}|${r.pays.map((p) => `${p.to}:${p.amount}`).join(',')}|${r.fee}`;

export interface IncomingSpend {
  code: string;
  id: string;
  signatures: number;
}

/** Payments the others left for this account on the relay: the copy with the most signatures of each, newest first. */
export async function incomingSpends(s: BtcSharedSaved): Promise<IncomingSpend[]> {
  if (!s.relay) return [];
  const [codes, gone] = await Promise.all([allFromGroup(s.relay), goneSet()]);
  const best = new Map<string, IncomingSpend & { at: number }>();
  codes.forEach((code, at) => {
    try {
      const r = readSpend(s, code);
      const id = spendId(s.address, r);
      if (gone.has(id)) return;
      const cur = best.get(id);
      if (!cur || r.signatures >= cur.signatures) best.set(id, { code: code.trim(), id, signatures: r.signatures, at });
    } catch {
      // not a payment for this account: ignore it
    }
  });
  return [...best.values()].sort((a, b) => b.at - a.at).map(({ at: _at, ...x }) => x);
}
