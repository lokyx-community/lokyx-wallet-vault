// A tiny observable value, so screens can subscribe without a state library.
import { useSyncExternalStore } from 'react';

export function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((v: T) => T)) {
      value = typeof next === 'function' ? (next as (v: T) => T)(value) : next;
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

export function useStore<T>(s: ReturnType<typeof store<T>>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
