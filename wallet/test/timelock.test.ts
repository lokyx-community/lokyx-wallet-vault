// Round trip against a stand-in drand network whose key we hold, using the same scheme as quicknet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { lockNote, unlockNote, roundFor, isLocked, QUICKNET } from '../src/lib/timelock.ts';

const sk = bls12_381.utils.randomSecretKey();
const fake = { ...QUICKNET, public_key: bytesToHex(bls12_381.G2.Point.BASE.multiply(bls12_381.G2.Point.Fn.fromBytes(sk)).toBytes()), hash: 'aa'.repeat(32) };
const beacon = async (round: number) => {
  const id = new Uint8Array(8);
  new DataView(id.buffer).setBigUint64(0, BigInt(round));
  const h = bls12_381.G1.hashToCurve(sha256(id), { DST: 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_' });
  const sig = (h as unknown as { multiply: (k: bigint) => { toBytes: () => Uint8Array } }).multiply(bls12_381.G1.Point.Fn.fromBytes(sk));
  return { round, randomness: '', signature: bytesToHex(sig.toBytes()) };
};

test('a locked note opens with the right round and not before', async () => {
  const opens = Math.floor(Date.now() / 1000) - 600; // a day that has come, so the library lets us try
  const note = 'Hello from the past. Nobody could read this early.';
  const locked = await lockNote(note, opens, fake);
  assert.ok(isLocked(locked));
  assert.ok(!locked.includes('Hello'));
  assert.equal(await unlockNote(locked, fake, beacon), note);
  // any other moment's signature doesn't open it
  await assert.rejects(unlockNote(locked, fake, (r: number) => beacon(r - 1)));
});

test('before the day it refuses outright', async () => {
  const locked = await lockNote('not yet', Math.floor(Date.now() / 1000) + 3600, fake);
  await assert.rejects(unlockNote(locked, fake, beacon), /too early/);
});

test('round for a time is never early', () => {
  const t = QUICKNET.genesis_time + 3000;
  const r = roundFor(t);
  assert.ok(QUICKNET.genesis_time + (r - 1) * QUICKNET.period >= t);
  assert.ok(QUICKNET.genesis_time + (r - 2) * QUICKNET.period < t);
});

test('plain notes pass through', async () => {
  assert.equal(await unlockNote('just text'), 'just text');
});
