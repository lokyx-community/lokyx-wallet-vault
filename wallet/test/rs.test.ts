import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../src/lib/rs.ts';

function rnd(n: number) {
  return Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
}

test('round trip with no errors', () => {
  const m = rnd(21);
  assert.deepEqual(decode(encode(m, 10), 10), m);
});

test('repairs up to 5 wrong bytes, every time', () => {
  for (let trial = 0; trial < 3000; trial++) {
    const m = rnd(21);
    const c = encode(m, 10);
    const k = 1 + (trial % 5);
    const used = new Set<number>();
    while (used.size < k) used.add(Math.floor(Math.random() * c.length));
    for (const i of used) c[i] ^= 1 + Math.floor(Math.random() * 255);
    assert.deepEqual(decode(c, 10), m, `trial ${trial} with ${k} errors`);
  }
});

test('too many errors are refused, not mis-repaired, almost always', () => {
  let wrong = 0;
  for (let trial = 0; trial < 3000; trial++) {
    const m = rnd(21);
    const c = encode(m, 10);
    for (let i = 0; i < 9; i++) c[(i * 3 + trial) % c.length] ^= 1 + Math.floor(Math.random() * 255);
    const d = decode(c, 10);
    if (d && !d.every((x, i) => x === m[i])) wrong++;
  }
  assert.ok(wrong < 30, `${wrong} wrong decodes of 3000`);
});
