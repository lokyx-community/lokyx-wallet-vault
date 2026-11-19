// An encrypted backup of the recovery words: one line of text (and so one QR code) that is useless without
// the password chosen when it was made. Restore by scanning or pasting it and typing the password, with no
// 24 words to type. scrypt turns the password into a key (slow on purpose, so guessing is slow); XChaCha20-
// Poly1305 seals the words and notices any change or wrong password. Pure code, tested in test/backup-seal.test.ts.

import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export type BackupKind = 'wallet' | 'vault';
export const MIN_PASSWORD = 8;
const PREFIX = 'lokyx-backup';
const VERSION = '1';
const COST = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };

const enc = new TextEncoder();
const dec = new TextDecoder();
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toB64(b: Uint8Array): string {
  let o = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    o += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '') + (i + 2 < b.length ? A[n & 63] : '');
  }
  return o;
}
function fromB64(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = A.indexOf(ch);
    if (v < 0) throw new Error('bad');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

const aad = (kind: BackupKind) => enc.encode(`${PREFIX}:${VERSION}:${kind}`);
/** `onProgress` gets 0 to 1 while the key is worked out, so the screen can show how far along it is. The cost itself never changes: old backups must still open. */
const key = (password: string, salt: Uint8Array, onProgress?: (p: number) => void) =>
  scryptAsync(enc.encode(password.normalize('NFKC')), salt, { ...COST, asyncTick: 8, onProgress });

/** The backup as one line: `lokyx-backup:1:wallet:<text>`. */
export async function sealBackup(secret: string, password: string, kind: BackupKind, onProgress?: (p: number) => void): Promise<string> {
  if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters for the backup password.`);
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const k = await key(password, salt, onProgress);
  const ct = xchacha20poly1305(k, nonce, aad(kind)).encrypt(enc.encode(secret));
  k.fill(0);
  const all = new Uint8Array(salt.length + nonce.length + ct.length);
  all.set(salt, 0);
  all.set(nonce, 16);
  all.set(ct, 40);
  return `${PREFIX}:${VERSION}:${kind}:${toB64(all)}`;
}

/** What a backup line says it is, before the password is asked. Null if it isn't a LOKYX backup. */
export function backupKind(text: string): BackupKind | null {
  const m = /^lokyx-backup:1:(wallet|vault):[A-Za-z0-9_-]+$/.exec(text.trim());
  return m ? (m[1] as BackupKind) : null;
}

/** Open a backup. Throws 'That password does not open this backup.' for a wrong password or a damaged backup. */
export async function openBackup(text: string, password: string, onProgress?: (p: number) => void): Promise<{ kind: BackupKind; secret: string }> {
  const t = text.trim();
  const kind = backupKind(t);
  if (!kind) throw new Error("That isn't a LOKYX backup. It starts with lokyx-backup:");
  let all: Uint8Array;
  try {
    all = fromB64(t.split(':')[3]);
  } catch {
    throw new Error('That backup is damaged. Copy it again.');
  }
  if (all.length < 16 + 24 + 17) throw new Error('That backup is damaged. Copy it again.');
  const k = await key(password, all.slice(0, 16), onProgress);
  try {
    const pt = xchacha20poly1305(k, all.slice(16, 40), aad(kind)).decrypt(all.slice(40));
    return { kind, secret: dec.decode(pt) };
  } catch {
    throw new Error('That password does not open this backup.');
  } finally {
    k.fill(0);
  }
}

// ---------- the backup as a file people can keep anywhere ----------

export const BACKUP_EXT = 'lokyx';
export const BACKUP_MIME = 'text/plain';

/** The name the file is saved under: `lokyx-wallet-backup.lokyx` or `lokyx-vault-backup.lokyx`. */
export const backupFileName = (kind: BackupKind) => `lokyx-${kind}-backup.${BACKUP_EXT}`;

/** What goes in the file: the same locked line, and one line of plain words saying what it is. The words stay locked. */
export function backupFileText(sealed: string): string {
  return `${sealed.trim()}\n`;
}

/** Find the backup in a file's text, even with a byte-order mark, blank lines or a mail client's extra lines around it. */
export function backupFromFile(text: string): string | null {
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const t = line.trim();
    if (backupKind(t)) return t;
  }
  return null;
}
