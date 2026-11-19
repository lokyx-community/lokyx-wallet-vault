// The phone's secure storage for the 24 words and private keys (see secrets-core.ts for the rules).

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { getItem, setItem, removeItem } from './kv';
import { store } from './store';
import { nsKey } from './ns';
import { hasScreenLock, makeSecrets, moveKeys, NoScreenLock, pickMode, secretOptions, upgradeToAuth, type Backend, type SecretMode, type UpgradeResult } from './secrets-core';

const web = Platform.OS === 'web';

/** True once a read showed the keys are gone for good (biometrics changed). The app shows a restore screen. */
export const keysLost = store(false);

let mode: SecretMode = 'auth';
/** On Android the person chose face unlock: keys stay in the phone's secure storage, and the wallet's own face or passcode check releases them. */
let faceChosen = false;
const FACE_KEY = 'w.secface';
export const faceUnlockOn = () => !web && faceChosen && mode === 'device';

/** True when reading a key makes the phone itself ask for a face or finger, so asking again just before is a second prompt for nothing. */
export const keystoreAsksForAuth = () => !web && mode === 'auth';
const MODE_KEY = 'w.secmode';

/** Decide once, on first use, and remember (a non-secret flag). */
export async function initSecretMode() {
  if (web) return;
  faceChosen = (await getItem(FACE_KEY).catch(() => null)) === '1';
  const saved = await getItem(MODE_KEY).catch(() => null);
  if (saved === 'auth' || saved === 'device') {
    mode = saved;
    return;
  }
  let enrolled = false;
  try {
    enrolled = await LocalAuthentication.isEnrolledAsync();
  } catch {}
  mode = pickMode({ os: Platform.OS === 'ios' ? 'ios' : 'android', biometricsEnrolled: enrolled });
  await setItem(MODE_KEY, mode).catch(() => {});
}

// Android shows one fingerprint/face prompt at a time; a second read while one is open fails with
// "Authentication is already in progress". So secure-store calls run one after another.
let queue: Promise<unknown> = Promise.resolve();
const oneAtATime = <T,>(f: () => Promise<T>): Promise<T> => {
  const next = queue.then(f, f);
  queue = next.catch(() => {});
  return next;
};

// What the person was just asked to approve ("Send 5 LYX"), so the phone's own prompt says so instead of a generic line.
// It lasts one minute and one read, so a later unrelated read never borrows it.
let reason: { text: string; at: number } | null = null;
export const promptFor = (text: string) => {
  reason = { text, at: Date.now() };
};
const takeReason = () => {
  const r = reason && Date.now() - reason.at < 60_000 ? reason.text : undefined;
  reason = null;
  return r;
};

const native: Backend = {
  get: (k, m) => oneAtATime(() => SecureStore.getItemAsync(k, secretOptions(m, SecureStore, takeReason()))),
  set: (k, v, m) => oneAtATime(() => SecureStore.setItemAsync(k, v, secretOptions(m, SecureStore, takeReason()))),
  del: (k) => SecureStore.deleteItemAsync(k),
};

// In a browser there is no secure hardware; keys stay in local storage as before (the web build is for trying the wallet).
const browser: Backend = { get: (k) => getItem(k), set: (k, v) => setItem(k, v), del: (k) => removeItem(k) };

/** Refuse to store keys on a phone with no screen lock at all. */
async function requireScreenLock() {
  if (web) return;
  let level = 1;
  try {
    level = await LocalAuthentication.getEnrolledLevelAsync();
  } catch {
    return; // can't tell: the platform's own storage rules still apply
  }
  if (!hasScreenLock(level)) throw new NoScreenLock();
}

const spaced = (b: Backend): Backend => ({
  get: (k, m) => b.get(nsKey(k), m),
  set: (k, v, m) => b.set(nsKey(k), v, m),
  del: (k) => b.del(nsKey(k)),
});

export const secrets = makeSecrets(spaced(web ? browser : native), () => mode, () => keysLost.set(true), requireScreenLock);

/**
 * Call after a successful unlock. A phone that stored its keys in 'device' mode (no biometric then) moves
 * them to 'auth' mode as soon as a biometric is enrolled. Never throws; on any trouble the keys stay as they were.
 */
export async function upgradeMode(names: string[]): Promise<UpgradeResult> {
  names = names.map((n) => nsKey(n));
  if (web || faceChosen) return 'not-needed';
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    const r = await upgradeToAuth({
      mode,
      enrolled: level >= 2,
      names,
      backend: native,
      saveMode: async (m) => {
        await setItem(MODE_KEY, m);
        mode = m;
      },
    });
    return r;
  } catch {
    return 'failed';
  }
}

/**
 * Switch between the phone's strong biometric (a fingerprint) and face unlock for releasing the keys. Face unlock on
 * Android is not strong enough for the phone's own key check, so choosing it moves the keys to device-only storage
 * (still hardware backed and never backed up) and the wallet asks for the face or passcode itself.
 * `names` are every stored key name, real wallet and decoy, since the mode is shared by both.
 */
export async function setFaceUnlock(on: boolean, names: string[]): Promise<'done' | 'failed' | 'unavailable'> {
  if (web || Platform.OS !== 'android') return 'unavailable';
  if (on === faceUnlockOn()) return 'done';
  if (!on) {
    try {
      if ((await LocalAuthentication.getEnrolledLevelAsync()) < LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG) return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  const r = await moveKeys({
    from: on ? 'auth' : 'device',
    to: on ? 'device' : 'auth',
    names,
    backend: native,
    saveMode: async (m) => {
      await setItem(MODE_KEY, m);
      await setItem(FACE_KEY, on ? '1' : '0');
      mode = m;
      faceChosen = on;
    },
  });
  return r === 'failed' ? 'failed' : 'done';
}
