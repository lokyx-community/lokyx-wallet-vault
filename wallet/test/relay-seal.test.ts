import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGroupKey, openMsg, sealMsg, topicOf } from '../src/lib/relay-seal.ts';
import { relayGet, relayNotify, relayPut, relayUrlOk } from '../src/lib/relay-client.ts';
import { RelayStore, checkPut } from '../src/lib/relay-store.ts';

test('relay seal: opens with the group key, and nothing else opens it', () => {
  const k = newGroupKey();
  const blob = sealMsg(k, 'lokyx-eth-safe:payment');
  assert.ok(!blob.includes('payment'));
  assert.equal(openMsg(k, blob), 'lokyx-eth-safe:payment');
  assert.equal(openMsg(newGroupKey(), blob), null);
  assert.equal(openMsg(k, blob.slice(0, -2) + (blob.endsWith('AA') ? 'BB' : 'AA')), null);
  assert.equal(openMsg(k, 'junk'), null);
  assert.notEqual(sealMsg(k, 'same'), sealMsg(k, 'same'));
});

test('relay seal: the topic is a hash of the key, the same for everyone who has it', () => {
  const k = newGroupKey();
  assert.match(topicOf(k), /^[0-9a-f]{64}$/);
  assert.equal(topicOf(k), topicOf(k));
  assert.notEqual(topicOf(k), topicOf(newGroupKey()));
  assert.throws(() => topicOf('short'), /bad group key/);
});

test('relay client: a message goes in sealed and comes out for the group, not for others', async () => {
  const store = new RelayStore();
  const f = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const j = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
    if (u.pathname === '/relay/put') {
      const m = checkPut(JSON.parse(String(init?.body)));
      if (typeof m === 'string') return j({ error: m }, 400);
      return j({ ok: true, seq: store.put(m.topic, m.blob, 1) });
    }
    if (u.pathname === '/relay/get') return j({ items: store.list(u.searchParams.get('topic')!, Number(u.searchParams.get('after')), 2) });
    return j({ ok: true });
  }) as unknown as typeof fetch;
  const k = newGroupKey();
  const seq = await relayPut('https://relay.example/', k, 'pay 1 ETH', f);
  assert.deepEqual(await relayGet('https://relay.example', k, 0, f), [{ seq, text: 'pay 1 ETH' }]);
  assert.deepEqual(await relayGet('https://relay.example', k, seq, f), []);
  assert.deepEqual(await relayGet('https://relay.example', newGroupKey(), 0, f), []);
  await relayNotify('https://relay.example', k, ['https://ntfy.sh/x'], f);
});

test('relay client: only https relays', () => {
  assert.equal(relayUrlOk('https://relay.example.com'), true);
  assert.equal(relayUrlOk('https://relay.example.com:8443/r'), true);
  assert.equal(relayUrlOk('http://relay.example.com'), false);
  assert.equal(relayUrlOk('https://localhost'), false);
});
