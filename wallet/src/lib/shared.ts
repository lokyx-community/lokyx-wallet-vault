// Shared LYX accounts (the multisig contract in contracts/multisig): making one, adding one you were
// put in, and reading its owners and the payments waiting for approval.

import { parseLyx } from './lokyx';
import { currentAddress } from './wallet';
import { resolveDeploy, shared, type SharedAcct } from './data';
import { callMethod, deploy, view } from './wcontracts';

export interface Payment {
  id: number;
  to: string;
  amount: string;
  note: string;
  by: string;
  state: 'waiting' | 'sent' | 'cancelled';
  approvals: string[];
}
export interface SharedInfo {
  owners: string[];
  threshold: number;
  balance: string;
  payments: Payment[];
}

const STATE = ['waiting', 'sent', 'cancelled'] as const;

export async function makeShared(name: string, owners: string[], threshold: number, start: string): Promise<SharedAcct> {
  const value = start.trim() ? parseLyx(start) : 0n;
  const tx = await deploy('multisig', [owners, threshold], value, value ? `${start} LYX` : '');
  const a: SharedAcct = { name: name.trim() || 'Shared account', address: '', tx, at: Date.now() };
  await shared.save((x) => [a, ...x]);
  return a;
}

/** Someone else made it with you as an owner: add it by its address. */
export async function addShared(name: string, address: string) {
  const info = await readShared(address, 0);
  if (!info.owners.includes(currentAddress())) throw new Error("You aren't one of this account's owners");
  if (shared.get().some((s) => s.address === address)) return;
  await shared.save((x) => [{ name: name.trim() || 'Shared account', address, at: Date.now() }, ...x]);
}

/** Fill in addresses of accounts whose deploy has landed; drop ones whose deploy failed. */
export async function resolveShared() {
  for (const s of shared.get().filter((x) => !x.address && x.tx)) {
    const a = await resolveDeploy(s.tx!);
    if (a) await shared.save((x) => x.map((y) => (y.tx === s.tx ? { ...y, address: a } : y)));
    if (a === '') await shared.save((x) => x.filter((y) => y.tx !== s.tx));
  }
}

/** The account and its latest payments (newest first). */
export async function readShared(address: string, recent = 15): Promise<SharedInfo> {
  const [owners, threshold, balance, next] = await view<[string[], number, string, number]>(address, 'info');
  const ids = Array.from({ length: Math.min(recent, next) }, (_, i) => next - 1 - i);
  const payments = await Promise.all(
    ids.map(async (id) => {
      const [[to, amount, note, by, state], approvals] = await Promise.all([view<[string, string, string, string, number]>(address, 'proposal', [id]), view<string[]>(address, 'approvals', [id])]);
      return { id, to, amount, note, by, state: STATE[state] ?? 'waiting', approvals } as Payment;
    }),
  );
  return { owners, threshold: Number(threshold), balance, payments };
}

export const deposit = (address: string, amount: string) => callMethod(address, 'deposit', [], parseLyx(amount), `${amount} LYX`);
export const propose = (address: string, to: string, amount: string, note: string) => callMethod(address, 'propose', [to, amount, note], 0n, `${amount} LYX`);
export const approve = (address: string, id: number) => callMethod(address, 'approve', [id]);
export const execute = (address: string, id: number) => callMethod(address, 'execute', [id]);
export const revoke = (address: string, id: number) => callMethod(address, 'revoke', [id]);
export const cancel = (address: string, id: number) => callMethod(address, 'cancel', [id]);
