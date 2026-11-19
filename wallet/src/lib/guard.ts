// The phone side of guard-core.ts: the trusted list, the switch for it, and the new-phone window, kept on the phone.

import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { resetHooks } from './wallet';
import {
  DEFAULT_PROTECTION, addTrusted, cancelOff, destinationState, newDeviceCheck, protectionActive, removeTrusted, requestOff, startNewDevice,
  type DestState, type NewDevice, type Protection, type Trusted,
} from './guard-core';

const K = { trusted: 'w.trusted', prot: 'w.trustprot', newdev: 'w.newdev', ndon: 'w.newdevon' };

/** The two-day limit on a restored phone is something the person turns on in Settings. It is off by default. */
export const newDeviceOn = store<boolean>(false);
export const useNewDeviceOn = () => useStore(newDeviceOn);
export async function setNewDeviceOn(v: boolean) {
  newDeviceOn.set(v);
  await setItem(K.ndon, JSON.stringify(v));
}

export const trusted = store<Trusted>({});
export const protection = store<Protection>(DEFAULT_PROTECTION);
export const newDevice = store<NewDevice | null>(null);
export const useTrusted = () => useStore(trusted);
export const useProtection = () => useStore(protection);
export const useNewDevice = () => useStore(newDevice);

const read = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    return (JSON.parse((await getItem(key)) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => setItem(key, JSON.stringify(v));

export async function loadGuard() {
  trusted.set(await read<Trusted>(K.trusted, {}));
  protection.set(await read<Protection>(K.prot, DEFAULT_PROTECTION));
  newDevice.set(await read<NewDevice | null>(K.newdev, null));
  newDeviceOn.set(await read<boolean>(K.ndon, false));
}
resetHooks.push(() => {
  trusted.set({});
  protection.set(DEFAULT_PROTECTION);
  newDevice.set(null);
});

/** Where a destination stands. When the protection is off (or its wait to turn off is over) every address counts as known. */
export function destinationNow(dest: string, known: string[], now = Date.now()): DestState {
  if (!protectionActive(protection.get(), now)) return { state: 'known' };
  return destinationState({ dest, known, trusted: trusted.get(), now });
}

export async function trustAddress(dest: string, now = Date.now()) {
  trusted.set(addTrusted(trusted.get(), dest, now));
  await write(K.trusted, trusted.get());
}
export async function untrustAddress(dest: string) {
  trusted.set(removeTrusted(trusted.get(), dest));
  await write(K.trusted, trusted.get());
}

/** Turning the protection off starts a wait. Nothing changes until it is over. */
export async function askProtectionOff(now = Date.now()) {
  protection.set(requestOff(protection.get(), now));
  await write(K.prot, protection.get());
}
export async function keepProtection() {
  protection.set(cancelOff(protection.get()));
  await write(K.prot, protection.get());
}
export async function setProtectionOn() {
  protection.set({ on: true });
  await write(K.prot, protection.get());
}
/** Once the wait to turn it off is over, make that permanent so it stays off. */
export async function settleProtection(now = Date.now()) {
  const p = protection.get();
  if (p.on && p.offAt !== undefined && now >= p.offAt) {
    protection.set({ on: false });
    await write(K.prot, protection.get());
  }
}

/** Called right after the words are typed in on this phone. */
export async function markNewDevice(now = Date.now()) {
  newDevice.set(startNewDevice(now));
  await write(K.newdev, newDevice.get());
}

/**
 * The first two days on a new phone: at most a tenth of the biggest balance can leave. `show` writes an amount in
 * words. When it fits, `commit()` counts it, and is called once the payment has really gone.
 */
export function newDeviceGate(asset: string, balance: bigint, value: bigint, show: (v: bigint) => string, now = Date.now()): { ok: true; commit: () => Promise<void> } | { ok: false; message: string } {
  if (!newDeviceOn.get()) return { ok: true, commit: async () => {} };
  const v = newDeviceCheck(newDevice.get(), now, asset, balance, value);
  if (!v.ok) {
    const left = Math.max(1, Math.ceil((v.until - now) / 3600_000));
    return {
      ok: false,
      message: `This phone was set up from your words less than 2 days ago, so only a small part of your balance can leave for now. You can send up to ${show(v.room)} more. This lifts in about ${left} h. It protects you if someone else restores your words.`,
    };
  }
  return { ok: true, commit: () => noteNewDevice(v.next) };
}
export async function noteNewDevice(next: NewDevice | null) {
  if (!next) return;
  newDevice.set(next);
  await write(K.newdev, next);
}
