// Time capsules: LYX and a note sealed in a contract until a date (contracts/examples/capsule).

import { switchHooks } from './ns';
import { base64 } from '@scure/base';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { rpc, type GasEstimate, type RunResult } from './rpc';
import { bytesToHex, hexToBytes } from './lokyx';
import { CAPSULE_ABI, CAPSULE_WASM } from './contracts';
import { currentAddress, sendContract, wallet } from './wallet';
import { addPending, resolveDeploy } from './data';
import { labelFor } from './format';
import { lockNote, unlockNote } from './timelock';

const CODE = base64.decode(CAPSULE_WASM);

export interface Capsule {
  /** contract address, once the deploy is in a block */
  address?: string;
  tx?: string;
  from: string;
  to: string;
  /** unix seconds */
  opens: number;
  sealed: number;
  title: string;
  amountLyx: string;
  /** the sender knows the note; the person it's for sees it on the day */
  note?: string;
  opened?: number;
}

export interface CapsuleState {
  from: string;
  to: string;
  opens: number;
  opened: number;
  amountLyx: string;
  sealed: number;
}

const list = store<Capsule[]>([]);
let loaded = false;
export async function loadCapsules() {
  if (loaded) return;
  loaded = true;
  const raw = await getItem('w.capsules');
  if (raw) list.set(JSON.parse(raw));
}
async function save(next: (c: Capsule[]) => Capsule[]) {
  list.set(next);
  await setItem('w.capsules', JSON.stringify(list.get()));
}
export const resetCapsules = () => list.set([]);
switchHooks.push(async () => {
  list.set([]);
  loaded = false;
  await loadCapsules();
});

/** The capsules this account sent or is getting. */
export function useCapsules() {
  const all = useStore(list);
  const me = currentAddress();
  return all.filter((c) => c.from === me || c.to === me);
}
export const capsuleFor = (address: string) => list.get().find((c) => c.address === address);
export const useCapsule = (address: string) => useStore(list).find((c) => c.address === address);

export async function readState(address: string): Promise<CapsuleState> {
  const [info, sealed] = await Promise.all([
    rpc<RunResult>('lyx_call', { to: address, method: 'info', args: [] }),
    rpc<RunResult>('lyx_call', { to: address, method: 'sealed', args: [] }),
  ]);
  if (!info.ok) throw new Error("That isn't a time capsule");
  const [from, to, opens, opened, amount] = info.result as [string, string, number, number, string];
  return { from, to, opens: Number(opens), opened: Number(opened), amountLyx: String(amount), sealed: Number(sealed.ok ? sealed.result : 0) };
}

/** Reads the note. Before the day the contract refuses, and this returns null. On the day it
 *  fetches that day's key from the time network and unlocks it. */
export async function readNote(address: string): Promise<string | null> {
  const r = await rpc<RunResult>('lyx_call', { to: address, method: 'note', args: [] });
  if (!r.ok) return null;
  return unlockNote(String(r.result ?? ''));
}

/** Locks the note to the opening day, ready to put in the contract. */
export const lockFor = (note: string, opens: number) => lockNote(note, opens);

/** Keeps a capsule someone shared with you (a link or its ring). */
export async function remember(address: string) {
  const s = await readState(address);
  await save((c) => [
    { address, from: s.from, to: s.to, opens: s.opens, sealed: s.sealed, opened: s.opened || undefined, title: '', amountLyx: s.amountLyx },
    ...c.filter((x) => x.address !== address),
  ]);
  return s;
}

export async function estimateSeal(to: string, opens: number, note: string, value: bigint) {
  return rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), code: bytesToHex(CODE), abi: CAPSULE_ABI, args: [to, opens, note], value: value.toString() });
}

let sealing = false;
export async function seal(p: { to: string; opens: number; note: string; locked: string; title: string; value: bigint; amountLyx: string; gas: number }) {
  // never two seals at once: a double slide would otherwise make two capsules
  if (sealing) throw new Error('A capsule is already being sealed. Wait a moment.');
  sealing = true;
  try {
    return await sealOnce(p);
  } finally {
    sealing = false;
  }
}

async function sealOnce(p: { to: string; opens: number; note: string; locked: string; title: string; value: bigint; amountLyx: string; gas: number }) {
  const input = await rpc<string>('lyx_encodeDeploy', { abi: CAPSULE_ABI, args: [p.to, p.opens, p.locked] });
  const h = await sendContract({ kind: 'deploy', code: CODE, abi: CAPSULE_ABI, input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(p.gas) }, '', p.value);
  const me = currentAddress();
  await addPending({ hash: h, from: me, to: '', amount: p.value > 0n ? `${p.amountLyx} LYX` : '', what: 'deploy', at: Date.now() });
  await save((c) => [{ tx: h, from: me, to: p.to, opens: p.opens, sealed: Math.floor(Date.now() / 1000), title: p.title, amountLyx: p.amountLyx, note: p.note }, ...c]);
  return h;
}

/** Fills in addresses of capsules whose deploy landed; drops ones the chain refused. */
export async function settleCapsules() {
  const waiting = list.get().filter((c) => !c.address && c.tx);
  for (const c of waiting) {
    const a = await resolveDeploy(c.tx!);
    if (a) await save((x) => x.map((y) => (y.tx === c.tx ? { ...y, address: a } : y)));
    else if (a === '') await save((x) => x.filter((y) => y.tx !== c.tx));
  }
}

async function call(address: string, method: string, value = 0n) {
  const g = await rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), to: address, method, args: [], value: value.toString() });
  if (!g.ok) throw new Error(g.error ?? 'The capsule said no');
  const input = await rpc<string>('lyx_encodeCall', { to: address, method, args: [] });
  return sendContract({ kind: 'call', input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(g.gasLimit) }, address, value);
}

export async function openCapsule(address: string) {
  const h = await call(address, 'open');
  await addPending({ hash: h, from: currentAddress(), to: address, amount: '', what: 'call', at: Date.now() });
  await save((x) => x.map((y) => (y.address === address ? { ...y, opened: Math.floor(Date.now() / 1000) } : y)));
  return h;
}

export async function addToCapsule(address: string, value: bigint, lyx: string) {
  const h = await call(address, 'add', value);
  await addPending({ hash: h, from: currentAddress(), to: address, amount: `${lyx} LYX`, what: 'call', at: Date.now() });
  return h;
}

export const forget = (key: string) => save((x) => x.filter((y) => (y.address ?? y.tx) !== key));
export const updateLocal = (address: string, p: Partial<Capsule>) => save((x) => x.map((y) => (y.address === address ? { ...y, ...p } : y)));

export function untilText(opens: number, now = Date.now() / 1000) {
  const s = Math.max(0, Math.round(opens - now));
  const d = Math.floor(s / 86400);
  if (d >= 730) return `in ${Math.floor(d / 365)} years`;
  if (d >= 60) return `in ${Math.round(d / 30.4)} months`;
  if (d >= 2) return `in ${d} days`;
  const h = Math.floor(s / 3600);
  if (h >= 2) return `in ${h} hours`;
  const m = Math.ceil(s / 60);
  return s <= 0 ? 'now' : `in ${m} min`;
}
export const dateText = (opens: number) => new Date(opens * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

export const capsuleTitle = (c: Capsule, me: string) =>
  c.title || (c.from === me && c.to === me ? 'For future you' : c.from === me ? `For ${labelFor(c.to)}` : `From ${labelFor(c.from)}`);
