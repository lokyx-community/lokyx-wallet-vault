// The wallet's own events: things that happened in the app that are not a payment (a vault made, a shared account
// made, money moved to the Apps wallet). Pure functions, tested in test/events.test.ts.

export type EventKind = 'vault' | 'shared' | 'apps';
export interface AppEvent {
  id: string;
  kind: EventKind;
  title: string;
  sub: string;
  /** unix seconds */
  time: number;
}

export const MAX_EVENTS = 200;

/** Adds an event, newest first, once per id, keeping the list short. */
export function addEvent(list: AppEvent[], e: AppEvent, max = MAX_EVENTS): AppEvent[] {
  if (list.some((x) => x.id === e.id)) return list;
  return [e, ...list].sort((a, b) => b.time - a.time).slice(0, max);
}

/** Reads a saved list back, dropping anything that is not an event. */
export function parseEvents(raw: string | null): AppEvent[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is AppEvent => !!x && typeof x.id === 'string' && ['vault', 'shared', 'apps'].includes(x.kind) && typeof x.title === 'string' && typeof x.sub === 'string' && Number.isFinite(x.time));
  } catch {
    return [];
  }
}
