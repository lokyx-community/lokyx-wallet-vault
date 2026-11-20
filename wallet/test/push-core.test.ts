import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_KEEP_MS, PUSH_TEXT, deadTokens, pushMessages, pushTokenOk } from '../src/lib/push-core.ts';
import { RelayStore, checkPush, checkPut } from '../src/lib/relay-store.ts';

const T = 'a'.repeat(64);
const A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const C = 'ExpoPushToken[cccccccccccccccccccccc]';

test('push: only real Expo tokens are accepted', () => {
  assert.equal(pushTokenOk(A), true);
  assert.equal(pushTokenOk(C), true);
  assert.equal(pushTokenOk('https://evil.example/x'), false);
  assert.equal(pushTokenOk('ExponentPushToken[]'), false);
  assert.equal(pushTokenOk(5), false);
  assert.equal(checkPush({ topic: T, token: A }) && (checkPush({ topic: T, token: A }) as { off: boolean }).off, false);
  assert.equal(checkPush({ topic: T, token: 'nope' }), 'bad token');
  assert.equal(checkPush({ topic: 'x', token: A }), 'bad topic');
  assert.equal((checkPush({ topic: T, token: A, off: true }) as { off: boolean }).off, true);
});

test('push: the sender is skipped and the text says nothing about the payment', () => {
  const m = pushMessages([A, B, C], T, B);
  assert.deepEqual(m.map((x) => x.to), [A, C]);
  for (const x of m) {
    assert.equal(x.title, PUSH_TEXT.title);
    assert.equal(x.body, 'A payment is waiting for your approval');
    assert.deepEqual(x.data, { topic: T });
    assert.equal(x.channelId, 'shared');
  }
  assert.equal(pushMessages([A], T).length, 1);
});

test('push: a skip token on a message is kept only when it is a real token', () => {
  const blob = 'x'.repeat(60);
  assert.deepEqual(checkPut({ topic: T, blob, skip: A }), { topic: T, blob, skip: A });
  assert.deepEqual(checkPut({ topic: T, blob, skip: 'junk' }), { topic: T, blob });
});

test('push: dead tokens are found by position in the answer', () => {
  const answer = { data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'MessageRateExceeded' } }] };
  assert.deepEqual(deadTokens([A, B, C], answer), [B]);
  assert.deepEqual(deadTokens([A], null), []);
  assert.deepEqual(deadTokens([A], { data: 'x' }), []);
});

test('push: the relay keeps phones per topic, caps them, drops dead ones and old ones, and survives a restart', () => {
  const s = new RelayStore();
  assert.equal(s.addPhone(T, A, 1000), true);
  assert.equal(s.addPhone(T, A, 2000), true); // the same phone again just refreshes
  assert.equal(s.addPhone(T, B, 1000), true);
  assert.deepEqual(s.phonesFor(T).sort(), [A, B].sort());
  for (let i = 0; i < 8; i++) assert.equal(s.addPhone(T, `ExponentPushToken[${String(i).repeat(10)}]`, 1000), true);
  assert.equal(s.addPhone(T, 'ExponentPushToken[zzzzzzzzzzzz]', 1000), false);
  const again = RelayStore.from(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again.phonesFor(T).sort(), s.phonesFor(T).sort());
  again.dropToken(A);
  assert.equal(again.phonesFor(T).includes(A), false);
  again.dropPhone(T, B);
  assert.equal(again.phonesFor(T).includes(B), false);
  // messages expiring does not forget the phones; two months of silence does
  const q = new RelayStore();
  q.addPhone(T, A, 1000);
  q.prune(1000 + PUSH_KEEP_MS - 1);
  assert.deepEqual(q.phonesFor(T), [A]);
  q.prune(1000 + PUSH_KEEP_MS + 1);
  assert.deepEqual(q.phonesFor(T), []);
});
