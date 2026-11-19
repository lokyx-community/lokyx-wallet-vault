import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryRead, restoreVerified, type RestoreDeps } from '../src/lib/recovery-core.ts';
import { makeSecrets, hasScreenLock, NoScreenLock, upgradeToAuth, classifyReadError, KeysUnreadable, type Backend, type SecretMode } from '../src/lib/secrets-core.ts';

// a stand-in for derivation: words -> "key" bytes -> "address"
const derive = (w: string, i: number) => new TextEncoder().encode(`${w}#${i}`);
const addressOf = (sk: Uint8Array) => 'addr:' + new TextDecoder().decode(sk);
const toHex = (b: Uint8Array) => new TextDecoder().decode(b);

function store(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const log: string[] = [];
  return {
    data, log,
    del: async (n: string) => { log.push('del ' + n); data.delete(n); },
    set: async (n: string, v: string) => { log.push('set ' + n); data.set(n, v); },
  };
}

function deps(words: string, st: ReturnType<typeof store>, accounts = 2): RestoreDeps {
  return {
    words, stored: Array.from({ length: accounts }, (_, i) => ({ index: i, address: addressOf(derive('right words', i)) })),
    isMnemonic: (w) => w.trim().split(/\s+/).length >= 2, normalize: (w) => w.trim().replace(/\s+/g, ' '),
    derive, addressOf, toHex, del: st.del, set: st.set, names: { phrase: 'w.phrase', key: (i) => `w.key.${i}` },
  };
}

test('a temporary error that looks like "keystore" then succeeds on retry loses nothing', async () => {
  const msg = 'android.security.KeyStoreException: temporary failure, try again';
  assert.equal(classifyReadError(new Error(msg)), 'lost'); // the regex does match it
  const st = store({ 'w.phrase': 'right words', 'w.key.0': 'k0' });
  let flaky = true;
  const backend: Backend = {
    async get(k) { if (flaky) throw new Error(msg); return st.data.get(k) ?? null; },
    async set(k, v) { st.data.set(k, v); }, async del(k) { st.data.delete(k); },
  };
  let lostFlag = false;
  const s = makeSecrets(backend, () => 'auth', () => { lostFlag = true; });
  await assert.rejects(() => s.get('w.phrase'), KeysUnreadable);
  assert.equal(lostFlag, true); // the screen appears...
  flaky = false;
  const r = await retryRead(() => s.get('w.phrase'), () => { lostFlag = false; });
  assert.equal(r, 'ok'); // ...Try again reads fine and clears it
  assert.equal(lostFlag, false);
  assert.equal(st.data.get('w.phrase'), 'right words');
  assert.equal(st.data.get('w.key.0'), 'k0');
  assert.deepEqual(st.log, []); // nothing was written or removed
});

test('retry that still fails keeps the screen and erases nothing', async () => {
  let cleared = false;
  const r = await retryRead(async () => { throw new Error('Key permanently invalidated'); }, () => { cleared = true; });
  assert.equal(r, 'still-lost');
  assert.equal(cleared, false);
  assert.equal(await retryRead(async () => { throw new Error('User canceled'); }, () => {}), 'cancelled');
});

test('restore with wrong words changes nothing', async () => {
  const st = store({ 'w.phrase': 'old', 'w.key.0': 'old0', 'w.key.1': 'old1' });
  const r = await restoreVerified(deps('wrong words', st));
  assert.deepEqual(r, { ok: false, reason: 'mismatch' });
  assert.deepEqual(st.log, []);
  assert.equal(st.data.get('w.phrase'), 'old');
  assert.equal(st.data.get('w.key.1'), 'old1');
});

test('restore with words that are not a phrase changes nothing either', async () => {
  const st = store({ 'w.phrase': 'old' });
  const d = deps('x', st);
  assert.deepEqual(await restoreVerified(d), { ok: false, reason: 'bad-words' });
  assert.deepEqual(await restoreVerified({ ...d, stored: [] }), { ok: false, reason: 'no-account' });
  assert.deepEqual(st.log, []);
});

test('restore with the right words replaces the keys for every account, wiping nothing else', async () => {
  const st = store({ 'w.phrase': 'old', 'w.key.0': 'old0', other: 'kept' });
  const r = await restoreVerified(deps('right words', st));
  assert.deepEqual(r, { ok: true });
  assert.equal(st.data.get('w.phrase'), 'right words');
  assert.equal(st.data.get('w.key.0'), 'right words#0');
  assert.equal(st.data.get('w.key.1'), 'right words#1');
  assert.equal(st.data.get('other'), 'kept');
});

test('the keys-lost screen never calls wipe()', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/app/keys-lost.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /wipe/);
  const w = readFileSync(new URL('../src/lib/wallet.ts', import.meta.url), 'utf8');
  const fn = w.slice(w.indexOf('export async function restoreKeys'), w.indexOf('export async function restoreKeys') + 900);
  assert.doesNotMatch(fn, /wipe\(/);
});

// ---------- screen lock ----------

test('no screen lock: keys are refused and nothing is written', async () => {
  assert.equal(hasScreenLock(0), false);
  assert.equal(hasScreenLock(1), true);
  assert.equal(hasScreenLock(3), true);
  const written: string[] = [];
  const b: Backend = { async get() { return null; }, async set(k) { written.push(k); }, async del() {} };
  const s = makeSecrets(b, () => 'device', () => {}, async () => { throw new NoScreenLock(); });
  await assert.rejects(() => s.set('w.phrase', 'x'), /no screen lock/i);
  assert.deepEqual(written, []);
});

// ---------- mode upgrade ----------

function modeBackend(failOnAuthWrite = 0) {
  const items = new Map<string, { v: string; m: SecretMode }>([['w.phrase', { v: 'p', m: 'device' }], ['w.key.0', { v: 'k0', m: 'device' }], ['w.key.1', { v: 'k1', m: 'device' }]]);
  let authWrites = 0;
  const b: Backend = {
    async get(k, m) { const e = items.get(k); if (!e) return null; if (e.m !== m) throw new Error('wrong mode'); return e.v; },
    async set(k, v, m) { if (m === 'auth' && ++authWrites === failOnAuthWrite) throw new Error('write failed'); items.set(k, { v, m }); },
    async del(k) { items.delete(k); },
  };
  return { b, items };
}
const NAMES = ['w.phrase', 'w.key.0', 'w.key.1'];

test('device mode with a biometric now enrolled: words and keys move to auth mode', async () => {
  const { b, items } = modeBackend();
  let saved: SecretMode | null = null;
  const r = await upgradeToAuth({ mode: 'device', enrolled: true, names: NAMES, backend: b, saveMode: async (m) => { saved = m; } });
  assert.equal(r, 'upgraded');
  assert.equal(saved, 'auth');
  for (const n of NAMES) assert.equal(items.get(n)!.m, 'auth');
  assert.equal(items.get('w.key.1')!.v, 'k1');
});

test('no biometric yet, or already auth: nothing happens', async () => {
  const { b, items } = modeBackend();
  const a = await upgradeToAuth({ mode: 'device', enrolled: false, names: NAMES, backend: b, saveMode: async () => assert.fail('no') });
  const c = await upgradeToAuth({ mode: 'auth', enrolled: true, names: NAMES, backend: b, saveMode: async () => assert.fail('no') });
  assert.deepEqual([a, c], ['not-needed', 'not-needed']);
  for (const n of NAMES) assert.equal(items.get(n)!.m, 'device');
});

test('a write that fails half way puts everything back in device mode, readable', async () => {
  const { b, items } = modeBackend(2);
  let saved = false;
  const r = await upgradeToAuth({ mode: 'device', enrolled: true, names: NAMES, backend: b, saveMode: async () => { saved = true; } });
  assert.equal(r, 'failed');
  assert.equal(saved, false);
  for (const n of NAMES) { assert.equal(items.get(n)!.m, 'device'); }
  assert.equal(await b.get('w.key.0', 'device'), 'k0');
});

test('keys can move from auth to device mode and back, and a failed move puts them back', async () => {
  const { moveKeys } = await import('../src/lib/secrets-core.ts');
  const items = new Map<string, { v: string; m: SecretMode }>(NAMES.map((n) => [n, { v: n + '!', m: 'auth' as SecretMode }]));
  let failAt = 0, writes = 0;
  const b: Backend = {
    async get(k, m) { const e = items.get(k); if (!e) return null; if (e.m !== m) throw new Error('wrong mode'); return e.v; },
    async set(k, v, m) { if (m === 'device' && failAt && ++writes === failAt) throw new Error('nope'); items.set(k, { v, m }); },
    async del(k) { items.delete(k); },
  };
  let saved: SecretMode | null = null;
  failAt = 2;
  assert.equal(await moveKeys({ from: 'auth', to: 'device', names: NAMES, backend: b, saveMode: async (m) => { saved = m; } }), 'failed');
  assert.equal(saved, null);
  for (const n of NAMES) assert.deepEqual(items.get(n), { v: n + '!', m: 'auth' });
  failAt = 0;
  assert.equal(await moveKeys({ from: 'auth', to: 'device', names: NAMES, backend: b, saveMode: async (m) => { saved = m; } }), 'upgraded');
  assert.equal(saved, 'device');
  assert.equal(await moveKeys({ from: 'device', to: 'auth', names: NAMES, backend: b, saveMode: async (m) => { saved = m; } }), 'upgraded');
  for (const n of NAMES) assert.deepEqual(items.get(n), { v: n + '!', m: 'auth' });
});
