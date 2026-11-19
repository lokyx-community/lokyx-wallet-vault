import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { secretOptions, pickMode, classifyReadError, makeSecrets, KeysUnreadable, type Backend, type SecretMode } from '../src/lib/secrets-core.ts';

const K = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 };

test('keys need the phone own check and never leave this phone', () => {
  const o = secretOptions('auth', K);
  assert.equal(o.requireAuthentication, true);
  assert.equal(o.keychainAccessible, K.WHEN_UNLOCKED_THIS_DEVICE_ONLY);
});

test('a phone with nothing to ask with still stores this-device-only', () => {
  const o = secretOptions('device', K);
  assert.equal(o.requireAuthentication, false);
  assert.equal(o.keychainAccessible, K.WHEN_UNLOCKED_THIS_DEVICE_ONLY);
});

test('mode: Android without a biometric falls back; iPhone uses its passcode', () => {
  assert.equal(pickMode({ os: 'android', biometricsEnrolled: false }), 'device');
  assert.equal(pickMode({ os: 'android', biometricsEnrolled: true }), 'auth');
  assert.equal(pickMode({ os: 'ios', biometricsEnrolled: false }), 'auth');
});

test('read errors: lost biometrics, cancelled prompt, anything else', () => {
  assert.equal(classifyReadError(new Error('KeyPermanentlyInvalidatedException: Key permanently invalidated')), 'lost');
  assert.equal(classifyReadError(new Error('Could not decrypt the item')), 'lost');
  assert.equal(classifyReadError(new Error('User canceled the authentication')), 'cancelled');
  assert.equal(classifyReadError({ message: 'weird', code: 'E_SOMETHING' }), 'other');
});

function fake(failWith?: Error) {
  const data = new Map<string, string>();
  const seen: SecretMode[] = [];
  const b: Backend = {
    async get(k, m) { seen.push(m); if (failWith) throw failWith; return data.get(k) ?? null; },
    async set(k, v, m) { seen.push(m); data.set(k, v); },
    async del(k) { data.delete(k); },
  };
  return { b, seen, data };
}

test('lost biometrics: the read raises the restore path once and throws KeysUnreadable', async () => {
  let lost = 0;
  const f = fake(new Error('Key permanently invalidated'));
  const s = makeSecrets(f.b, () => 'auth', () => lost++);
  await assert.rejects(() => s.get('w.phrase'), KeysUnreadable);
  assert.equal(lost, 1);
});

test('a cancelled prompt is not "lost"', async () => {
  let lost = 0;
  const f = fake(new Error('User canceled'));
  const s = makeSecrets(f.b, () => 'auth', () => lost++);
  await assert.rejects(() => s.get('w.phrase'), /canceled/);
  assert.equal(lost, 0);
});

test('writes use the chosen mode and round trip', async () => {
  const f = fake();
  const s = makeSecrets(f.b, () => 'auth', () => {});
  await s.set('a', 'secret');
  assert.equal(await s.get('a'), 'secret');
  await s.del('a');
  assert.equal(await s.get('a'), null);
  assert.deepEqual(new Set(f.seen), new Set(['auth']));
});

test('the real storage module asks for the strict options and the words/keys use it', () => {
  const src = readFileSync(new URL('../src/lib/secrets.ts', import.meta.url), 'utf8');
  assert.match(src, /secretOptions\(m, SecureStore[,)]/);
  const w = readFileSync(new URL('../src/lib/wallet.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(w, /getItem\(K\.(key|phrase)/);
  assert.doesNotMatch(w, /setItem\(K\.(key|phrase)/);
  const sc = readFileSync(new URL('../src/ui/ScreenGuard.tsx', import.meta.url), 'utf8');
  assert.match(sc, /usePreventScreenCapture/);
});
