import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));

test('Android asks only for camera, biometrics and notifications; the rest is blocked', () => {
  assert.deepEqual([...app.android.permissions].sort(), ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS', 'android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT']);
  assert.ok(app.android.blockedPermissions.includes('android.permission.RECORD_AUDIO'));
});

test('there is a production build profile that makes an app bundle with a rising version code', () => {
  assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.equal(eas.build.production.autoIncrement, true);
  assert.ok(app.android.versionCode >= 1);
});

test('secure storage, notifications and background tasks are configured', () => {
  const names = app.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
  for (const n of ['expo-secure-store', 'expo-notifications', 'expo-background-task', 'expo-local-authentication']) assert.ok(names.includes(n), n);
});

test('the first-launch testnet notice and the mainnet-off default exist', () => {
  const notice = readFileSync(new URL('../src/ui/BetaNotice.tsx', import.meta.url), 'utf8');
  assert.match(notice, /Testnet beta/);
  assert.match(notice, /not real money/);
  const core = readFileSync(new URL('../src/lib/multichain-core.ts', import.meta.url), 'utf8');
  assert.match(core, /allowMainnet: false/);
});

test('no API keys or secrets in the source', () => {
  const files = ['src/lib/multichain.ts', 'src/lib/multichain-core.ts', 'src/lib/rpc.ts'];
  for (const f of files) assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /api[_-]?key|apikey|secret\s*[:=]\s*['"][A-Za-z0-9]{16,}/i);
});
