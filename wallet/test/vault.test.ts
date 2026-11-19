import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSettings, describeOp, recoveryKeys, blocksFor, duration, pendingLine, KEY_THEFT_NOTICE, DELAYS } from '../src/lib/vault-core.ts';
import { addressFromPrivateKey, deriveKey, newShortMnemonic, hexToBytes, COIN, type Op } from '../src/lib/lokyx.ts';

const v = JSON.parse(readFileSync(new URL('../../testdata/vectors.json', import.meta.url), 'utf8'));
const owner = v.addresses ? Object.values(v.addresses as Record<string, string>)[0] : '';
const mk = () => {
  const a = recoveryKeys(newShortMnemonic());
  return { safe: a.safe, recovery: a.recovery };
};

test('recovery phrase: index 0 is the safe address, index 1 the recovery key', () => {
  const phrase = newShortMnemonic();
  const r = recoveryKeys(phrase);
  assert.equal(r.safe, addressFromPrivateKey(deriveKey(phrase, 0)));
  assert.equal(r.recovery, addressFromPrivateKey(deriveKey(phrase, 1)));
  assert.notEqual(r.safe, r.recovery);
});

test('blocks for a wait round up and match the web app', () => {
  assert.equal(blocksFor(86400, 60), 1440n);
  assert.equal(blocksFor(3600, 60), 60n);
  assert.equal(blocksFor(1, 60), 1n);
});

test('settings are checked the way the node checks them', () => {
  const k = mk();
  const ownerAddr = addressFromPrivateKey(deriveKey(newShortMnemonic(), 0));
  const ok = buildSettings({ owner: ownerAddr, recovery: k.recovery, safe: k.safe, allowanceLyx: '50', delaySecs: 86400, blockTime: 60 });
  assert.equal(ok.error, undefined);
  assert.equal(ok.settings!.allowance, 50n * COIN);
  assert.equal(ok.settings!.delay, 1440n);
  assert.match(buildSettings({ owner: ownerAddr, recovery: ownerAddr, safe: k.safe, allowanceLyx: '50', delaySecs: 86400, blockTime: 60 }).error!, /different/);
  assert.match(buildSettings({ owner: ownerAddr, recovery: k.recovery, safe: ownerAddr, allowanceLyx: '50', delaySecs: 86400, blockTime: 60 }).error!, /different/);
  assert.match(buildSettings({ owner: ownerAddr, recovery: k.recovery, safe: k.safe, allowanceLyx: '0', delaySecs: 86400, blockTime: 60 }).error!, /more than zero/);
  assert.match(buildSettings({ owner: ownerAddr, recovery: k.recovery, safe: k.safe, allowanceLyx: '5', delaySecs: 60, blockTime: 60 }).error!, /1 hour/);
  assert.match(buildSettings({ owner: ownerAddr, recovery: k.recovery, safe: 'nope', allowanceLyx: '5', delaySecs: 86400, blockTime: 60 }).error!, /safe address/);
});

test('an heir waits at least 30 days and twice the vault delay', () => {
  const k = mk();
  const ownerAddr = addressFromPrivateKey(deriveKey(newShortMnemonic(), 0));
  const heir = recoveryKeys(newShortMnemonic()).safe;
  const base = { owner: ownerAddr, recovery: k.recovery, safe: k.safe, allowanceLyx: '5', delaySecs: 7 * 86400, blockTime: 60 };
  assert.match(buildSettings({ ...base, heir: { address: heir, waitSecs: 20 * 86400 } }).error!, /too short/);
  assert.equal(buildSettings({ ...base, heir: { address: heir, waitSecs: 182 * 86400 } }).error, undefined);
  assert.match(buildSettings({ ...base, heir: { address: ownerAddr, waitSecs: 182 * 86400 } }).error!, /different/);
});

test('clear signing says exactly what happens, in words', () => {
  const ctx = { blockTime: 60, me: owner };
  const to = recoveryKeys(newShortMnemonic()).safe;
  const w = describeOp({ kind: 'vaultWithdraw', to, amount: 500n * COIN }, { ...ctx, label: (a) => (a === to ? 'lyx1abc…' : undefined) }, 1440);
  assert.equal(w.title, 'Start a withdrawal of 500 LYX');
  assert.match(w.lines[0], /^Start a withdrawal of 500 LYX to lyx1abc…, released in 24 hours\.$/);
  assert.match(describeOp({ kind: 'keyRotate', newKey: to }, ctx, 1440).lines.join(' '), /Rotation won't save your funds/);
  assert.match(describeOp({ kind: 'vaultSweep', vault: to }, ctx).lines[0], /right now, with no wait/);
});

test('every vault and key operation has a description (none falls through)', () => {
  const ctx = { blockTime: 60, me: owner };
  const kinds = new Set(v.cases.map((c: any) => c.tx.op.kind as string));
  for (const k of ['vaultCreate', 'vaultUpdate', 'vaultWithdraw', 'vaultClose', 'vaultCancel', 'vaultSweep', 'vaultHeirClaim', 'keyRotate', 'keyCancelRotate']) {
    assert.ok(kinds.has(k));
    const c = v.cases.find((x: any) => x.tx.op.kind === k);
    const o = c.tx.op;
    const op: Op = k === 'vaultCreate' || k === 'vaultUpdate'
      ? { kind: k, settings: { recovery: o.settings.recovery, safe: o.settings.safe, delay: BigInt(o.settings.delay), allowance: BigInt(o.settings.allowance), heir: o.settings.heir ? { address: o.settings.heir.address, inactiveBlocks: BigInt(o.settings.heir.inactiveBlocks) } : null } }
      : k === 'vaultWithdraw' ? { kind: k, to: o.to, amount: BigInt(o.amount) }
      : k === 'vaultClose' ? { kind: k }
      : k === 'vaultCancel' ? { kind: k, id: hexToBytes(o.id) }
      : k === 'vaultSweep' || k === 'vaultHeirClaim' ? { kind: k, vault: o.vault }
      : k === 'keyRotate' ? { kind: k, newKey: o.newKey }
      : { kind: 'keyCancelRotate', account: o.account };
    const d = describeOp(op, ctx, 100);
    assert.ok(!/not described here/.test(d.lines.join(' ')), k);
    assert.ok(d.title.length > 3);
  }
});

test('countdowns and pending lines', () => {
  assert.equal(duration(3600 * 24), '24 hours');
  assert.equal(duration(30), '30 seconds');
  const to = recoveryKeys(newShortMnemonic()).safe;
  const ctx = { blockTime: 60, me: owner, label: () => 'Savings' };
  assert.equal(pendingLine({ id: '0x1', kind: 'withdraw', releaseHeight: 1100, byHeir: false, to, amount: (5n * COIN).toString() }, 1000, ctx), 'Withdrawal of 5 LYX to Savings, releases in 1 h 40 min');
  assert.match(pendingLine({ id: '0x1', kind: 'update', releaseHeight: 900, byHeir: false }, 1000, ctx), /next block/);
  assert.match(pendingLine({ id: '0x1', kind: 'close', releaseHeight: 1100, byHeir: true }, 1000, ctx), /^Heir claim/);
});

test('the key-theft notice is the agreed wording', () => {
  assert.equal(KEY_THEFT_NOTICE, "Key stolen? Rotation won't save your funds. Sweep your vault or move your funds now.");
  assert.equal(DELAYS[1][1], 86400);
});
