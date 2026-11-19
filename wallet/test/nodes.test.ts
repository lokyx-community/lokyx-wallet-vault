import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vetNode, cleanUrl, order, syncState } from '../src/lib/nodes-core.ts';

const g1 = '0x' + '11'.repeat(32);
const g2 = '0x' + '22'.repeat(32);

test('a node on the expected chain is accepted and its genesis is remembered', () => {
  const v = vetNode({ chainId: 77703, genesisHash: g1 }, 77703, null);
  assert.ok(v.ok && v.pin.genesisHash === g1);
});

test('a node on another chain id is refused', () => {
  const v = vetNode({ chainId: 77701, genesisHash: g1 }, 77703, null);
  assert.ok(!v.ok && /different network/.test(v.reason));
});

test('a node with a different genesis than the pinned one is refused', () => {
  const v = vetNode({ chainId: 77703, genesisHash: g2 }, 77703, { chainId: 77703, genesisHash: g1 });
  assert.ok(!v.ok && /different genesis/.test(v.reason));
  assert.ok(vetNode({ chainId: 77703, genesisHash: g1 }, 77703, { chainId: 77703, genesisHash: g1 }).ok);
});

test('garbage from a "node" is refused', () => {
  assert.ok(!vetNode({}, 77703, null).ok);
  assert.ok(!vetNode({ chainId: 77703, genesisHash: 'nope' }, 77703, null).ok);
  assert.ok(!vetNode({ chainId: 77703 }, 77703, null).ok);
});

test('addresses typed by a person are cleaned and checked', () => {
  assert.equal(cleanUrl(' http://192.168.1.20:28701/ '), 'http://192.168.1.20:28701');
  assert.equal(cleanUrl('https://node.example/rpc'), 'https://node.example/rpc');
  assert.equal(cleanUrl('ftp://x'), null);
  assert.equal(cleanUrl('node.example'), null);
});

test('fallback order: the chosen node first, nodes that just failed last', () => {
  const list = [{ url: 'a', label: 'a' }, { url: 'b', label: 'b' }, { url: 'c', label: 'c' }];
  assert.deepEqual(order(list, 'b', {}, 0).map((n) => n.url), ['b', 'a', 'c']);
  assert.deepEqual(order(list, 'b', { b: 100 }, 0).map((n) => n.url), ['a', 'c', 'b']);
  assert.deepEqual(order(list, 'b', { b: 100 }, 200).map((n) => n.url), ['b', 'a', 'c']);
});

test('sync: in sync, behind, or not producing blocks', () => {
  assert.equal(syncState({ height: 100, bestTimestamp: 1000 }, 101, 60, 1010), 'synced');
  assert.equal(syncState({ height: 90, bestTimestamp: 1000 }, 101, 60, 1010), 'behind');
  assert.equal(syncState({ height: 100, bestTimestamp: 1000 }, 100, 60, 1000 + 60 * 21), 'stale');
});

test('a real lokyxd genesis hash (plain hex, no 0x) is accepted, and pins equal to the 0x form', () => {
  const plain = '11'.repeat(32);
  const v = vetNode({ chainId: 77703, genesisHash: plain }, 77703, null);
  assert.ok(v.ok);
  assert.ok(vetNode({ chainId: 77703, genesisHash: g1 }, 77703, v.ok ? v.pin : null).ok);
  assert.ok(vetNode({ chainId: 77703, genesisHash: plain.toUpperCase() }, 77703, { chainId: 77703, genesisHash: g1 }).ok);
  assert.ok(!vetNode({ chainId: 77703, genesisHash: '22'.repeat(32) }, 77703, { chainId: 77703, genesisHash: g1 }).ok);
  assert.ok(!vetNode({ chainId: 77703, genesisHash: '11'.repeat(31) }, 77703, null).ok);
});

