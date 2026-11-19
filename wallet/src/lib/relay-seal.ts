// Sealing for the relay. The people of one shared account hold one random group key, handed over in the setup invite.
// The relay only sees a topic (a hash of that key) and sealed bytes, so it cannot read, change or forge a message.
// Even so, a phone never trusts what comes out: a payment is checked against the owners' signatures before it is shown.

import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toB64(b: Uint8Array): string {
  let o = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    o += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '') + (i + 2 < b.length ? A[n & 63] : '');
  }
  return o;
}
export function fromB64(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = A.indexOf(ch);
    if (v < 0) throw new Error('not a relay message');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

/** A new random group key for a shared account. */
export const newGroupKey = (): string => toB64(randomBytes(32));

const keyBytes = (k: string): Uint8Array => {
  const b = fromB64(k);
  if (b.length !== 32) throw new Error('bad group key');
  return b;
};

/** True if this is a group key this version can use (32 bytes, in the relay's text form). */
export const groupKeyOk = (k: string): boolean => {
  try {
    return fromB64(k.trim()).length === 32; // pasted keys often carry a space or a line break
  } catch {
    return false;
  }
};

/** The mailbox name: a hash of the key, so the relay learns nothing about who or what it is for. */
export const topicOf = (groupKey: string): string =>
  [...sha256(new Uint8Array([...enc.encode('lokyx-relay-topic-v1'), ...keyBytes(groupKey)]))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Seal a message for the group. A fresh nonce each time, so the same text never looks the same twice. */
export function sealMsg(groupKey: string, text: string): string {
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(keyBytes(groupKey), nonce).encrypt(enc.encode(text));
  return toB64(new Uint8Array([...nonce, ...ct]));
}

/** Open a message. Returns null for anything that was not sealed with this key, or was changed on the way. */
export function openMsg(groupKey: string, blob: string): string | null {
  try {
    const b = fromB64(blob);
    if (b.length < 24 + 16) return null;
    return dec.decode(xchacha20poly1305(keyBytes(groupKey), b.slice(0, 24)).decrypt(b.slice(24)));
  } catch {
    return null;
  }
}
