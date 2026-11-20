// The phone's use of the relay: where it is, leaving a message for the group, reading what the group left, and
// remembering which payments you dismissed. Sealing is in relay-seal.ts and the network calls are in relay-client.ts.

import { getItem, setItem } from './kv';
import { relayGet, relayPut, relayUrlOk } from './relay-client';

export const DEFAULT_RELAY = 'https://relay.naptunemist.xyz';

/** The relay to use: the one saved in `w.relayUrl` if it is a proper https address, otherwise the default. */
export async function relayBase(): Promise<string> {
  const v = ((await getItem('w.relayUrl')) ?? '').trim();
  return v && relayUrlOk(v) ? v : DEFAULT_RELAY;
}

/** Leave a message for everyone on the account. False when there is no key (an older account) or the relay did not answer. */
export async function sendToGroup(key: string | undefined, text: string): Promise<boolean> {
  if (!key) return false;
  try {
    await relayPut(await relayBase(), key, text, fetch, (await getItem('w.push.token')) ?? undefined);
    return true;
  } catch {
    return false;
  }
}

/** Everything the group has left in the last week, oldest first. Throws if the relay cannot be reached. */
export async function allFromGroup(key: string): Promise<string[]> {
  return (await relayGet(await relayBase(), key, 0)).map((m) => m.text);
}

const GONE = 'w.relay.gone';
export async function goneSet(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse((await getItem(GONE)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
/** Stop showing a payment (declined or sent). */
export async function dismissPay(id: string): Promise<void> {
  const g = await goneSet();
  g.add(id);
  await setItem(GONE, JSON.stringify([...g].slice(-300)));
}
