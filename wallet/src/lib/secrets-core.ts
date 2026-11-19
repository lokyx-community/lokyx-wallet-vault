// How the recovery words and private keys are stored. No native imports here, so the rules can be
// tested on their own (test/secrets.test.ts); src/lib/secrets.ts plugs in the phone's storage.
//
// Keys are stored so that only this phone, unlocked, and only after the phone's own check (Face ID,
// fingerprint or device passcode) can read them. They never go to backups or other devices.

export type SecretMode = 'auth' | 'device';

/** What expo-secure-store needs to be told. `K` is SecureStore's own constants. */
export function secretOptions(mode: SecretMode, K: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: number }, prompt = 'Unlock your LOKYX keys') {
  return {
    // 'auth': the phone itself asks for Face ID / fingerprint / passcode on every read.
    // 'device': a phone with nothing to ask with (no biometrics enrolled on Android) keeps the key in
    // hardware-backed storage that is still this-device-only, and the wallet's own passcode guards it.
    requireAuthentication: mode === 'auth',
    keychainAccessible: K.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    authenticationPrompt: prompt,
  };
}

/** Which mode a phone gets. iPhones use the passcode when there's no Face ID; Android needs a biometric. */
export function pickMode(p: { os: 'ios' | 'android' | 'web'; biometricsEnrolled: boolean }): SecretMode {
  if (p.os === 'android' && !p.biometricsEnrolled) return 'device';
  return 'auth';
}

export type ReadFailure = 'lost' | 'cancelled' | 'other';

/**
 * What a failed read means. 'lost': the phone's biometrics changed (or the key is otherwise gone), so the
 * stored keys can never be read again and the person has to restore from their 24 words.
 * 'cancelled': they backed out of the prompt; nothing is wrong.
 */
export function classifyReadError(e: unknown): ReadFailure {
  const m = String((e as { message?: string; code?: string })?.message ?? e) + ' ' + String((e as { code?: string })?.code ?? '');
  if (/cancel|user.?cancel|dismiss|lockout|not.?authenticat/i.test(m)) return 'cancelled';
  if (/invalidat|permanent|keystore|decrypt|bad.?padding|aead|unrecoverable|-25293|-25300|errSecItemNotFound|key.*(missing|not found)/i.test(m)) return 'lost';
  return 'other';
}

export class KeysUnreadable extends Error {
  constructor() {
    super("This phone's keys can't be read any more (its fingerprint or face settings changed). Restore your wallet from your 24 words.");
    this.name = 'KeysUnreadable';
  }
}

export interface Backend {
  get(key: string, mode: SecretMode): Promise<string | null>;
  set(key: string, value: string, mode: SecretMode): Promise<void>;
  del(key: string): Promise<void>;
}

/**
 * A secret store over a backend. `mode` is chosen once per phone. A read that fails because the keys were
 * invalidated reports it through `onLost` and throws KeysUnreadable; one the person cancelled just throws.
 */
export function makeSecrets(backend: Backend, mode: () => SecretMode, onLost: () => void, beforeSet: () => Promise<void> = async () => {}) {
  return {
    async get(key: string): Promise<string | null> {
      try {
        return await backend.get(key, mode());
      } catch (e) {
        const why = classifyReadError(e);
        if (why === 'lost') {
          onLost();
          throw new KeysUnreadable();
        }
        throw e;
      }
    },
    async set(key: string, value: string) {
      await beforeSet(); // refuses (NoScreenLock) before anything is written
      const m = mode();
      try {
        await backend.set(key, value, m);
      } catch (e) {
        // no screen lock or no biometrics at all: refuse rather than quietly store the key unprotected
        if (m === 'auth' && classifyReadError(e) === 'other') throw new Error('Set a screen lock (passcode, fingerprint or face) on this phone first, then try again.');
        throw e;
      }
    },
    del: (key: string) => backend.del(key),
  };
}

// ---------- screen lock ----------

/** expo-local-authentication's SecurityLevel: 0 NONE, 1 SECRET (PIN/pattern/password), 2 weak biometric, 3 strong. */
export const hasScreenLock = (level: number) => level >= 1;

export class NoScreenLock extends Error {
  constructor() {
    super('This phone has no screen lock. Set a PIN, pattern, password, fingerprint or face in the phone settings first; LOKYX will not keep your keys on a phone anyone can open.');
    this.name = 'NoScreenLock';
  }
}

// ---------- moving a 'device' phone to 'auth' once it has a biometric ----------

export type UpgradeResult = 'upgraded' | 'not-needed' | 'failed';

/**
 * A phone that had no biometric when the keys were stored holds them in 'device' mode. When one is enrolled
 * later (and the person has just unlocked the wallet), store the same words and keys in 'auth' mode.
 * Everything is read into memory first; if any write fails, what was rewritten is put back in 'device' mode
 * and the mode stays 'device', so nothing becomes unreadable.
 */
export async function upgradeToAuth(d: { mode: SecretMode; enrolled: boolean; names: string[]; backend: Backend; saveMode(m: SecretMode): Promise<void> }): Promise<UpgradeResult> {
  if (d.mode !== 'device' || !d.enrolled) return 'not-needed';
  return moveKeys({ from: 'device', to: 'auth', names: d.names, backend: d.backend, saveMode: d.saveMode });
}

/**
 * Store the same words and keys under another mode. Everything is read into memory first; if any write fails,
 * what was rewritten is put back the way it was and the mode does not change, so nothing becomes unreadable.
 */
export async function moveKeys(d: { from: SecretMode; to: SecretMode; names: string[]; backend: Backend; saveMode(m: SecretMode): Promise<void> }): Promise<UpgradeResult> {
  if (d.from === d.to) return 'not-needed';
  const held: [string, string][] = [];
  try {
    for (const n of d.names) {
      const v = await d.backend.get(n, d.from);
      if (v != null) held.push([n, v]);
    }
  } catch {
    return 'failed';
  }
  try {
    for (const [n, v] of held) {
      await d.backend.set(n, v, d.to);
    }
    await d.saveMode(d.to);
    return 'upgraded';
  } catch {
    for (const [n, v] of held) await d.backend.set(n, v, d.from).catch(() => {});
    return 'failed';
  }
}
