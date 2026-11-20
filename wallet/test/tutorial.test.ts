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
