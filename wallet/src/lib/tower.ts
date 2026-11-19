// The phone's watchtower list (alerts only, see tower-core.ts): which towers to tell, and a private channel to be told on.

import { randomBytes } from '@noble/hashes/utils.js';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { resetHooks, wallet } from './wallet';
import { ntfyLink, newTopic, registerWithTowers, type TowerResult } from './tower-core';

interface Towers {
  urls: string[];
  topic: string;
}
const KEY = 'w.towers';
export const towers = store<Towers>({ urls: [], topic: '' });
export const useTowers = () => useStore(towers);
resetHooks.push(() => towers.set({ urls: [], topic: '' }));

export async function loadTowers() {
  try {
    const t = JSON.parse((await getItem(KEY)) ?? 'null') as Towers | null;
    if (t && Array.isArray(t.urls)) towers.set(t);
  } catch {}
}
const save = () => setItem(KEY, JSON.stringify(towers.get()));

/** The channel the towers send to. Made once, and long enough that nobody can guess it. */
export async function ensureTopic() {
  if (towers.get().topic) return towers.get().topic;
  towers.set({ ...towers.get(), topic: newTopic(randomBytes) });
  await save();
  return towers.get().topic;
}
export const alertLink = () => ntfyLink(towers.get().topic);

export async function addTower(url: string) {
  const u = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+(\/\S*)?$/.test(u)) throw new Error('A tower address starts with https://');
  if (towers.get().urls.includes(u)) return;
  towers.set({ ...towers.get(), urls: [...towers.get().urls, u] });
  await save();
}
export async function removeTower(url: string) {
  towers.set({ ...towers.get(), urls: towers.get().urls.filter((x) => x !== url) });
  await save();
}

const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  return { ok: r.ok, status: r.status };
};

/** Tell every tower to watch every account of this wallet. Returns one result per tower and account. */
export async function registerAll(): Promise<TowerResult[]> {
  await ensureTopic();
  const out: TowerResult[] = [];
  for (const a of wallet.get().accounts) {
    out.push(...(await registerWithTowers(towers.get().urls, { account: a.address, notify: [alertLink()] }, post)));
  }
  return out;
}
