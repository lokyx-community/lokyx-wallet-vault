// The phone side of appswallet-core.ts: remembers the Apps wallet's address and makes it from the words once.

import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { readPhrase, resetHooks } from './wallet';
import { ethKey } from './multichain-core';
import { APPS_INDEX } from './appswallet-core';

export const apps = store<{ address: string | null }>({ address: null });
export const useApps = () => useStore(apps);
export const appsAddress = () => apps.get().address;

export async function loadApps() {
  try {
    const a = JSON.parse((await getItem('w.apps')) ?? 'null') as { address?: string } | null;
    apps.set({ address: a?.address ?? null });
  } catch {
    apps.set({ address: null });
  }
}
resetHooks.push(() => apps.set({ address: null }));

/** Make the Apps wallet (once). Needs the phone's check, because it reads the words. */
export async function ensureApps(): Promise<string> {
  const have = apps.get().address;
  if (have) return have;
  const phrase = await readPhrase();
  if (!phrase) throw new Error('No recovery words on this phone');
  const k = ethKey(phrase, APPS_INDEX);
  k.sk.fill(0);
  apps.set({ address: k.address });
  await setItem('w.apps', JSON.stringify({ address: k.address }));
  return k.address;
}
