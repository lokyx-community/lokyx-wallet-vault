import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIALS, parseSeen, withSeen, hasSeen, serializeSeen, nextStep } from '../src/lib/tutorial-core.ts';

test('every tutorial has 3 steps, each at most two short sentences', () => {
  for (const t of Object.values(TUTORIALS)) {
    assert.equal(t.steps.length, 3, t.id);
    for (const s of t.steps) {
      assert.ok(s.line.length <= 110, `${t.id}: too long`);
      assert.ok((s.line.match(/\. /g) ?? []).length <= 1, `${t.id}: more than two sentences`);
    }
  }
});

test('first time: not seen. After it is seen once it stays seen, and never doubles', () => {
  let seen = parseSeen(null);
  assert.equal(hasSeen(seen, 'vault'), false);
  seen = withSeen(seen, 'vault');
  seen = withSeen(seen, 'vault');
  assert.deepEqual(seen, ['vault']);
  assert.equal(hasSeen(seen, 'apps'), false);
});

test('saved list round-trips; junk and unknown ids are ignored', () => {
  assert.deepEqual(parseSeen(serializeSeen(['apps', 'swap'])), ['apps', 'swap']);
  assert.deepEqual(parseSeen('not json'), []);
  assert.deepEqual(parseSeen('{"a":1}'), []);
  assert.deepEqual(parseSeen('["apps","nope",3]'), ['apps']);
});

test('next walks the steps and the last one finishes', () => {
  assert.deepEqual(nextStep(0, 3), { i: 1, done: false });
  assert.deepEqual(nextStep(2, 3), { i: 2, done: true });
});

import { GRID, STEP, ip, eo, eio, sampled, asFn, trail } from '../src/lib/tutorial-motion.ts';

test('the sample grid starts at 0, ends at STEP and only goes up', () => {
  assert.equal(GRID[0], 0);
  assert.ok(Math.abs(GRID[GRID.length - 1] - STEP) < 1e-9);
  for (let i = 1; i < GRID.length; i++) assert.ok(GRID[i] > GRID[i - 1]);
  assert.equal(sampled((u) => u * 2).length, GRID.length);
});

test('easing stays inside 0..1 and hits both ends', () => {
  for (const f of [eo, eio]) {
    assert.equal(f(-1), 0);
    assert.equal(f(0), 0);
    assert.equal(f(1), 1);
    assert.equal(f(5), 1);
    for (let t = 0; t <= 1; t += 0.05) assert.ok(f(t) >= 0 && f(t) <= 1);
  }
  assert.ok(eo(0.5) > 0.5, 'eases out: ahead of linear at the midpoint');
});

test('ip walks along keyframes and clamps at the ends', () => {
  assert.equal(ip(-1, [0, 1, 2], [10, 20, 40]), 10);
  assert.equal(ip(0.5, [0, 1, 2], [10, 20, 40]), 15);
  assert.equal(ip(1.5, [0, 1, 2], [10, 20, 40]), 30);
  assert.equal(ip(9, [0, 1, 2], [10, 20, 40]), 40);
});

test('asFn keeps numbers still and trails get fainter and smaller', () => {
  assert.equal(asFn(7, 0)(3), 7);
  assert.equal(asFn(undefined, 5)(3), 5);
  assert.equal(asFn((u) => u + 1, 0)(3), 4);
  assert.ok(trail(1).fade > trail(3).fade && trail(1).shrink > trail(3).shrink && trail(1).delay < trail(3).delay);
});
