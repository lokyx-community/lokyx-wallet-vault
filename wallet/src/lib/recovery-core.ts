// Getting back into the keys without ever destroying them first. No native imports, so it is tested
// on its own (test/recovery.test.ts).
//
// A failed read can look like "the keys are gone" and still be a temporary Android hiccup. So nothing
// here erases anything until the 24 words have been checked against the address the phone already has.

import { classifyReadError } from './secrets-core.ts';

export type RetryResult = 'ok' | 'still-lost' | 'cancelled' | 'other';

/** Read once more. Only a clean read clears the "keys lost" state; nothing is written or removed. */
export async function retryRead(read: () => Promise<unknown>, clear: () => void): Promise<RetryResult> {
  try {
    await read();
    clear();
    return 'ok';
  } catch (e) {
    const why = classifyReadError(e);
    return why === 'lost' || (e as Error)?.name === 'KeysUnreadable' ? 'still-lost' : why;
  }
}

export interface StoredAccount {
  index: number;
  address: string;
}

export interface RestoreDeps {
  /** The 24 (or 12) words as the person typed them. */
  words: string;
  /** The public addresses this phone already holds (not secret, so readable even when the keys aren't). */
  stored: StoredAccount[];
  isMnemonic(words: string): boolean;
  normalize(words: string): string;
  derive(words: string, index: number): Promise<Uint8Array> | Uint8Array;
  addressOf(sk: Uint8Array): string;
  toHex(b: Uint8Array): string;
  del(name: string): Promise<void>;
  set(name: string, value: string): Promise<void>;
  names: { phrase: string; key(index: number): string };
}

export type RestoreResult = { ok: true } | { ok: false; reason: 'no-account' | 'bad-words' | 'mismatch' };

/**
 * Put the keys back from the words, keeping the wallet as it is. The order matters:
 *   1. check the words and derive account 0, compare with the stored address. Mismatch or bad words:
 *      return, having written and removed nothing.
 *   2. derive every stored account's key in memory.
 *   3. only then replace the stored words and keys.
 */
export async function restoreVerified(d: RestoreDeps): Promise<RestoreResult> {
  const first = d.stored.find((a) => a.index === 0) ?? d.stored[0];
  if (!first) return { ok: false, reason: 'no-account' };
  if (!d.isMnemonic(d.words)) return { ok: false, reason: 'bad-words' };
  const words = d.normalize(d.words);
  const sk0 = await d.derive(words, first.index);
  const matches = d.addressOf(sk0).toLowerCase() === first.address.toLowerCase();
  if (!matches) {
    sk0.fill(0);
    return { ok: false, reason: 'mismatch' };
  }
  const keys: { index: number; hex: string }[] = [{ index: first.index, hex: d.toHex(sk0) }];
  sk0.fill(0);
  for (const a of d.stored) {
    if (a.index === first.index) continue;
    const sk = await d.derive(words, a.index);
    if (d.addressOf(sk).toLowerCase() !== a.address.toLowerCase()) {
      sk.fill(0);
      return { ok: false, reason: 'mismatch' };
    }
    keys.push({ index: a.index, hex: d.toHex(sk) });
    sk.fill(0);
  }
  // everything is checked: now replace what can't be read
  await d.del(d.names.phrase).catch(() => {});
  for (const k of keys) await d.del(d.names.key(k.index)).catch(() => {});
  await d.set(d.names.phrase, words);
  for (const k of keys) await d.set(d.names.key(k.index), k.hex);
  return { ok: true };
}
