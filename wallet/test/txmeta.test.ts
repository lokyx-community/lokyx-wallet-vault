import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, withNote, withTag } from '../src/lib/txmeta-core.ts';

test('notes: set, trim, clear, and an empty entry is dropped', () => {
  let m = withNote({}, 'a', '  Birthday   gift ');
  assert.equal(m.a.note, 'Birthday gift');
  m = withTag(m, 'a', 'Gift');
  assert.deepEqual(m.a.tags, ['Gift']);
  m = withNote(m, 'a', '');
  assert.deepEqual(m.a, { note: undefined, tags: ['Gift'] });
  m = withTag(m, 'a', 'Gift');
  assert.equal(m.a, undefined);
});
test('search: every word must appear, in any order, any case', () => {
  assert.equal(matches('maya gift', 'Maya', 'Birthday gift'), true);
  assert.equal(matches('maya rent', 'Maya', 'Birthday gift'), false);
  assert.equal(matches('', 'x'), true);
  assert.equal(matches('0.25', undefined, '0.250 ETH'), true);
});
