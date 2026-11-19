// The saved list of the wallet's own events, shown in Activity next to payments.

import { useEffect } from 'react';
import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { resetHooks } from './wallet';
import { addEvent, parseEvents, type AppEvent, type EventKind } from './events-core';

const KEY = 'w.events';
export const events = store<AppEvent[]>([]);
resetHooks.push(() => events.set([]));
let loaded = false;

export async function loadEvents() {
  if (loaded) return;
  loaded = true;
  const saved = parseEvents(await getItem(KEY).catch(() => null));
  events.set((cur) => saved.reduce((acc, e) => addEvent(acc, e), cur));
}

/** Writes one event down. Never throws: a missing line in Activity must not break what the person was doing. */
export async function logEvent(kind: EventKind, title: string, sub: string, id?: string) {
  try {
    await loadEvents();
    const time = Math.floor(Date.now() / 1000);
    events.set((cur) => addEvent(cur, { id: id ?? `${kind}:${time}:${Math.random().toString(36).slice(2, 8)}`, kind, title, sub, time }));
    await setItem(KEY, JSON.stringify(events.get()));
  } catch {}
}

export function useEvents(): AppEvent[] {
  useEffect(() => { loadEvents(); }, []);
  return useStore(events);
}
