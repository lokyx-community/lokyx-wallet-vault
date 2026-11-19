// Encrypted wallet storage in the browser.
// The recovery phrase is encrypted with XChaCha20-Poly1305 under a key from Argon2id
// (19 MiB, 2 passes: OWASP's minimum, chosen so unlocking stays under a few seconds in JS).
// Nothing leaves the device; the node only ever sees signed transactions.

import { argon2idAsync } from '@noble/hashes/argon2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes, bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { addressFromPrivateKey, deriveKey, normalizeMnemonic } from './lokyx';

const KEY = 'lokyx.vault.v1';
const AAD = utf8ToBytes('LOKYX-web-vault-v1');
const KDF = { t: 2, m: 19456, p: 1, dkLen: 32 };

export interface StoredVault {
  v: 1;
  address: string;
  salt: string;
  nonce: string;
  ct: string;
  createdAt: number;
  backedUp: boolean;
}

export interface Unlocked {
  address: string;
  secretKey: Uint8Array;
  phrase: string;
}

function read(): StoredVault | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredVault) : null;
  } catch {
    return null;
  }
}

function write(v: StoredVault) {
  localStorage.setItem(KEY, JSON.stringify(v));
}

export const loadVault = read;

export async function createVault(phrase: string, password: string): Promise<Unlocked> {
  if (password.length < 8) throw new Error('Use at least 8 characters');
  const normalized = normalizeMnemonic(phrase);
  const secretKey = deriveKey(normalized, 0);
  const address = addressFromPrivateKey(secretKey);
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const key = await argon2idAsync(utf8ToBytes(password), salt, KDF);
  const ct = xchacha20poly1305(key, nonce, AAD).encrypt(utf8ToBytes(normalized));
  key.fill(0);
  write({ v: 1, address, salt: bytesToHex(salt), nonce: bytesToHex(nonce), ct: bytesToHex(ct), createdAt: Date.now(), backedUp: false });
  return { address, secretKey, phrase: normalized };
}

export async function unlockVault(password: string): Promise<Unlocked> {
  const v = read();
  if (!v) throw new Error('No wallet on this device');
  const key = await argon2idAsync(utf8ToBytes(password), hexToBytes(v.salt), KDF);
  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(key, hexToBytes(v.nonce), AAD).decrypt(hexToBytes(v.ct));
  } catch {
    throw new Error('Wrong password');
  } finally {
    key.fill(0);
  }
  const phrase = new TextDecoder().decode(plain);
  plain.fill(0);
  const secretKey = deriveKey(phrase, 0);
  const address = addressFromPrivateKey(secretKey);
  if (address !== v.address) throw new Error('Stored wallet is corrupted');
  return { address, secretKey, phrase };
}

export function markBackedUp() {
  const v = read();
  if (v) write({ ...v, backedUp: true });
}

export function deleteVault() {
  localStorage.removeItem(KEY);
}
