// The phone's side of the relay: leave a sealed message, fetch new ones, ask for a ping. Plain fetch, no secrets here.
// What goes in is already sealed (relay-seal.ts), so the address is only ever a mailbox.

import { openMsg, sealMsg, topicOf } from './relay-seal.ts';

type Fetch = typeof fetch;
const clean = (base: string) => base.replace(/\/+$/, '');

/** https only. A relay on a bare address or plain http would hand the topic to anyone on the path. */
export const relayUrlOk = (base: string): boolean => /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(base) && !/localhost/i.test(base);

async function call<T>(f: Fetch, url: string, init?: RequestInit): Promise<T> {
  const r = await f(url, { ...init, signal: AbortSignal.timeout(12_000) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `The relay answered ${r.status}`);
  return j;
}

/** Leave a message for the others. Returns its number on the relay. */
export async function relayPut(base: string, groupKey: string, text: string, f: Fetch = fetch): Promise<number> {
  const j = await call<{ seq: number }>(f, `${clean(base)}/relay/put`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: topicOf(groupKey), blob: sealMsg(groupKey, text) }) });
  return j.seq;
}

/** Everything new since `after`. Anything that does not open with the group key is dropped, not shown. */
export async function relayGet(base: string, groupKey: string, after: number, f: Fetch = fetch): Promise<{ seq: number; text: string }[]> {
  const j = await call<{ items: { seq: number; blob: string }[] }>(f, `${clean(base)}/relay/get?topic=${topicOf(groupKey)}&after=${after}`);
  return j.items.flatMap((i) => {
    const text = openMsg(groupKey, i.blob);
    return text == null ? [] : [{ seq: i.seq, text }];
  });
}

/** Ask the relay to ping these https links (ntfy topics or webhooks) when a message lands. The ping only says one is waiting. */
export async function relayNotify(base: string, groupKey: string, notify: string[], f: Fetch = fetch): Promise<void> {
  await call<{ ok: boolean }>(f, `${clean(base)}/relay/notify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: topicOf(groupKey), notify }) });
}
