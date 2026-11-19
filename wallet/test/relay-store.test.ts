import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PER_TOPIC, RELAY_TTL_MS, RelayStore, checkNotify, checkPut } from '../src/lib/relay-store.ts';

const T = 'a'.repeat(64);
const B = 'x'.repeat(60);

test('relay: only a hashed topic and a sealed blob are accepted', () => {
  assert.deepEqual(checkPut({ topic: T, blob: B }), { topic: T, blob: B });
  assert.equal(checkPut({ topic: 'abc', blob: B }), 'bad topic');
  assert.equal(checkPut({ topic: T, blob: 'short' }), 'bad message');
  assert.equal(checkPut({ topic: T, blob: 'a b'.repeat(20) }), 'bad message');
  assert.equal(checkPut({ topic: T, blob: 'x'.repeat(13_000) }), 'message too big');
  assert.equal(checkPut(null), 'bad topic');
});

test('relay: messages come back in order, only the new ones, and expire after a week', () => {
  const s = new RelayStore();
  const a = s.put(T, B, 1000) as number;
  const b = s.put(T, B + 'y', 2000) as number;
  assert.deepEqual(s.list(T, 0, 3000).map((i) => i.seq), [a, b]);
  assert.deepEqual(s.list(T, a, 3000).map((i) => i.seq), [b]);
  assert.deepEqual(s.list('b'.repeat(64), 0, 3000), []);
  assert.equal(s.list(T, 0, 1000 + RELAY_TTL_MS).length, 1);
  assert.equal(s.prune(1000 + RELAY_TTL_MS + 1), 1);
  assert.equal(s.prune(2000 + RELAY_TTL_MS + 1), 1);
  assert.equal(s.size, 0);
});

test('relay: a topic keeps its newest messages only', () => {
  const s = new RelayStore();
  for (let i = 0; i < MAX_PER_TOPIC + 5; i++) s.put(T, B, i);
  assert.equal(s.list(T, 0, 10).length, MAX_PER_TOPIC);
});

test('relay: pings need https links, and the store survives a restart', () => {
  assert.equal(checkNotify({ topic: T, notify: ['http://x.example/a'] }), 'notify links must be https');
  assert.equal(checkNotify({ topic: T, notify: ['https://10.0.0.1/a'] }), 'notify links must be https');
  const ok = checkNotify({ topic: T, notify: ['https://ntfy.sh/mine'] });
  assert.deepEqual(ok, { topic: T, notify: ['https://ntfy.sh/mine'] });
  const s = new RelayStore();
  s.put(T, B, 5);
  s.watch(T, ['https://ntfy.sh/mine']);
  const r = RelayStore.from(JSON.parse(JSON.stringify(s)));
  assert.equal(r.list(T, 0, 10).length, 1);
  assert.deepEqual(r.pingsFor(T), ['https://ntfy.sh/mine']);
  assert.equal(RelayStore.from('junk').size, 0);
});
