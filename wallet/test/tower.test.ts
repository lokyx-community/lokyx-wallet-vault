import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRegistration, newTopic, notifyOk, ntfyLink, protectedBy, registerWithTowers, tick } from '../src/lib/tower-core.ts';
import type { Account } from '../src/lib/rpc.ts';

const ACC = 'lyx1qpvvh9m7xk2d8c5r4t6y3u0w9e8a7s5d4f3g2';
const pending = (id: string): Account => ({ address: ACC, balance: '0', nonce: 0, vault: { pending: [{ id, kind: 'withdraw', to: 'lyx1thief', amountLyx: '500', releaseHeight: 100 }] } } as unknown as Account);

test('only https alert addresses are accepted', () => {
  assert.equal(notifyOk('https://ntfy.sh/secret-topic'), true);
  assert.equal(notifyOk('http://ntfy.sh/x'), false);
  assert.equal(notifyOk('https://localhost/x'), false);
  assert.equal(notifyOk('https://10.0.0.5/x'), false);
  assert.equal(notifyOk('not a url'), false);
  assert.equal(typeof checkRegistration({ account: 'bad', notify: ['https://ntfy.sh/a'] }), 'string');
  assert.equal(typeof checkRegistration({ account: ACC, notify: [] }), 'string');
  assert.equal(typeof checkRegistration({ account: ACC, notify: ['http://x.com/a'] }), 'string');
  assert.deepEqual(checkRegistration({ account: ACC, notify: ['https://ntfy.sh/a'], extra: 1 }), { account: ACC, notify: ['https://ntfy.sh/a'] });
});

test('a waiting withdrawal is told once to every address; a node that is down tells nothing', async () => {
  const told = new Set<string>();
  const log: string[] = [];
  const deps = { told, getAccount: async () => pending('ab'.repeat(32)), send: async (u: string, _t: string, x: string) => { log.push(u + '|' + x); } };
  const regs = [{ account: ACC, notify: ['https://ntfy.sh/a', 'https://hooks.example/b'] }];
  assert.equal(await tick(regs, deps), 1);
  assert.equal(log.length, 2);
  assert.match(log[0], /withdrawal of 500 LYX/);
  assert.equal(await tick(regs, deps), 0); // already told
  assert.equal(log.length, 2);
  const down = { ...deps, told: new Set<string>(), getAccount: async () => { throw new Error('down'); } };
  assert.equal(await tick(regs, down), 0);
  assert.equal(down.told.size, 0);
});

test('if one address fails the other still counts; if all fail it is tried again', async () => {
  const told = new Set<string>();
  let n = 0;
  const regs = [{ account: ACC, notify: ['https://bad.example/a', 'https://ok.example/b'] }];
  const send = async (u: string) => { n++; if (u.includes('bad')) throw new Error('nope'); };
  assert.equal(await tick(regs, { told, getAccount: async () => pending('cd'.repeat(32)), send }), 1);
  const allBad = new Set<string>();
  assert.equal(await tick(regs, { told: allBad, getAccount: async () => pending('ef'.repeat(32)), send: async () => { throw new Error('x'); } }), 0);
  assert.equal(allBad.size, 0);
  assert.ok(n >= 2);
});

test('registering with several towers reports each one', async () => {
  const post = async (url: string) => {
    if (url.startsWith('https://a.')) return { ok: true, status: 200 };
    if (url.startsWith('https://b.')) return { ok: false, status: 503 };
    throw new Error('offline');
  };
  const rs = await registerWithTowers(['https://a.example/', 'https://b.example', 'https://c.example'], { account: ACC, notify: ['https://ntfy.sh/a'] }, post);
  assert.deepEqual(rs.map((r) => r.ok), [true, false, false]);
  assert.equal(rs[1].error, 'It answered 503');
  assert.equal(rs[2].error, 'Could not be reached');
  assert.equal(protectedBy(rs), 1);
});

test('the private topic is long and different each time', () => {
  const r = () => crypto.getRandomValues(new Uint8Array(16));
  const a = newTopic(r);
  assert.match(a, /^lokyx-[0-9a-z]{24}$/);
  assert.notEqual(a, newTopic(r));
  assert.equal(ntfyLink(a), `https://ntfy.sh/${a}`);
});
