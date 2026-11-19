import test from 'node:test';
import assert from 'node:assert/strict';
import { addEvent, parseEvents, type AppEvent } from '../src/lib/events-core.ts';

const e = (id: string, time: number): AppEvent => ({ id, kind: 'vault', title: 'Vault created', sub: 'Ethereum', time });

test('events are kept newest first, once per id', () => {
  let l: AppEvent[] = [];
  l = addEvent(l, e('a', 10));
  l = addEvent(l, e('b', 20));
  l = addEvent(l, e('a', 99));
  assert.deepEqual(l.map((x) => x.id), ['b', 'a']);
  assert.equal(l.find((x) => x.id === 'a')!.time, 10);
});

test('the list is capped', () => {
  let l: AppEvent[] = [];
  for (let i = 0; i < 12; i++) l = addEvent(l, e(`x${i}`, i), 5);
  assert.equal(l.length, 5);
  assert.equal(l[0].id, 'x11');
});

test('a saved list is read back, and junk is dropped', () => {
  assert.deepEqual(parseEvents(null), []);
  assert.deepEqual(parseEvents('not json'), []);
  assert.deepEqual(parseEvents('{"a":1}'), []);
  const good = e('g', 5);
  assert.deepEqual(parseEvents(JSON.stringify([good, { id: 1 }, { ...good, kind: 'nope' }, null])), [good]);
});
