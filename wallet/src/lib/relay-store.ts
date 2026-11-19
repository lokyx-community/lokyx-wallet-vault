// The relay's mailbox: a place where the people of a shared account leave sealed messages for each other.
// The server only ever sees a topic (a hash) and an opaque sealed blob. It cannot read a payment, and it holds no key.
// Messages are kept for a week and then dropped. Pure code, used by watchtower/server.mjs and tested in test/relay-store.test.ts.

import { notifyOk } from './tower-core.ts';

export const RELAY_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_BLOB = 12_000;
export const MAX_PER_TOPIC = 200;
export const MAX_TOPICS = 20_000;
export const MAX_NOTIFY = 10;

export const TOPIC_RE = /^[0-9a-f]{64}$/;
const BLOB_RE = /^[A-Za-z0-9_-]+$/;

export interface RelayItem {
  seq: number;
  at: number;
  blob: string;
}

export function checkTopic(t: unknown): string | null {
  return typeof t === 'string' && TOPIC_RE.test(t) ? t : null;
}

/** A message to leave: a topic and a sealed blob, nothing else. */
export function checkPut(b: unknown): { topic: string; blob: string } | string {
  const x = b as { topic?: unknown; blob?: unknown } | null;
  const topic = checkTopic(x?.topic);
  if (!topic) return 'bad topic';
  if (typeof x?.blob !== 'string' || x.blob.length < 40) return 'bad message';
  if (x.blob.length > MAX_BLOB) return 'message too big';
  if (!BLOB_RE.test(x.blob)) return 'bad message';
  return { topic, blob: x.blob };
}

/** Where to ping when something lands on a topic. https only, the same rule as the watchtower. */
export function checkNotify(b: unknown): { topic: string; notify: string[] } | string {
  const x = b as { topic?: unknown; notify?: unknown } | null;
  const topic = checkTopic(x?.topic);
  if (!topic) return 'bad topic';
  if (!Array.isArray(x?.notify) || x.notify.length > MAX_NOTIFY) return 'bad notify list';
  const notify = (x.notify as unknown[]).filter((u): u is string => typeof u === 'string');
  if (notify.length !== (x.notify as unknown[]).length || !notify.every(notifyOk)) return 'notify links must be https';
  return { topic, notify };
}

export class RelayStore {
  private boxes = new Map<string, RelayItem[]>();
  private pings = new Map<string, string[]>();
  private n = 0;

  get size(): number {
    return this.boxes.size;
  }

  /** Leave a message. Returns its number, or a reason it was refused. */
  put(topic: string, blob: string, now: number): number | string {
    const box = this.boxes.get(topic);
    if (!box && this.boxes.size >= MAX_TOPICS) return 'full';
    const list = box ?? [];
    if (list.length >= MAX_PER_TOPIC) list.shift();
    const seq = ++this.n;
    list.push({ seq, at: now, blob });
    this.boxes.set(topic, list);
    return seq;
  }

  /** Everything on a topic after a given number, oldest first. */
  list(topic: string, after: number, now: number): RelayItem[] {
    return (this.boxes.get(topic) ?? []).filter((i) => i.seq > after && now - i.at < RELAY_TTL_MS);
  }

  watch(topic: string, notify: string[]) {
    if (notify.length) this.pings.set(topic, notify);
    else this.pings.delete(topic);
  }
  pingsFor(topic: string): string[] {
    return this.pings.get(topic) ?? [];
  }

  /** Drop anything older than the keeping time. Run now and then. */
  prune(now: number): number {
    let gone = 0;
    for (const [t, list] of this.boxes) {
      const keep = list.filter((i) => now - i.at < RELAY_TTL_MS);
      gone += list.length - keep.length;
      if (keep.length) this.boxes.set(t, keep);
      else {
        this.boxes.delete(t);
        this.pings.delete(t);
      }
    }
    return gone;
  }

  toJSON() {
    return { n: this.n, boxes: [...this.boxes], pings: [...this.pings] };
  }
  static from(j: unknown): RelayStore {
    const s = new RelayStore();
    const x = j as { n?: number; boxes?: [string, RelayItem[]][]; pings?: [string, string[]][] } | null;
    if (!x || typeof x.n !== 'number' || !Array.isArray(x.boxes)) return s;
    s.n = x.n;
    for (const [t, l] of x.boxes) if (checkTopic(t) && Array.isArray(l)) s.boxes.set(t, l.filter((i) => typeof i?.seq === 'number' && typeof i?.at === 'number' && typeof i?.blob === 'string'));
    for (const [t, u] of x.pings ?? []) if (checkTopic(t) && Array.isArray(u) && u.every(notifyOk)) s.pings.set(t, u);
    return s;
  }
}
