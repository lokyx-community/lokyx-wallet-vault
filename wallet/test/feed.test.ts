import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btcItems, ethItems, filterFeed, mergeFeed, solItems, trxItems, type FeedItem } from '../src/lib/feed-core.ts';

test('feed: every coin maps to the same shape, with the right sign, unit and explorer link', () => {
  const b = btcItems('signet', [{ txid: 'aa', confirmed: true, time: 100, delta: 2_500_000n }, { txid: 'bb', confirmed: false, delta: -1_000n }]);
  assert.deepEqual([b[0].kind, b[0].amount, b[0].unit], ['received', '0.025', 'sBTC']);
  assert.deepEqual([b[1].kind, b[1].time, b[1].amount], ['sent', 0, '0.00001']);
  assert.equal(b[0].url, 'https://mempool.space/signet/tx/aa');
  const e = ethItems('base-sepolia', [{ hash: '0xabc', delta: -1_500_000_000_000_000_000n, decimals: 18, symbol: 'ETH', failed: false, time: 50 }]);
  assert.deepEqual([e[0].kind, e[0].amount, e[0].unit, e[0].net], ['sent', '1.5', 'ETH', 'Base']);
  assert.equal(e[0].url, 'https://sepolia.basescan.org/tx/0xabc');
  const s = solItems('devnet', [{ id: 'sig', time: 70, delta: 2_500_000_000n, failed: false }]);
  assert.deepEqual([s[0].kind, s[0].amount, s[0].unit], ['received', '2.5', 'SOL']);
  assert.ok(s[0].url!.includes('cluster=devnet'));
  const t = trxItems('nile', [{ id: 'tx1', time: 60, delta: -5_000_000n, failed: true, other: 'TSe' }]);
  assert.deepEqual([t[0].kind, t[0].amount, t[0].failed, t[0].other], ['sent', '5', true, 'TSe']);
});

test('feed: merged newest first, waiting items on top, duplicates dropped', () => {
  const mk = (id: string, time: number, coin: FeedItem['coin'] = 'btc'): FeedItem => ({ id, coin, kind: 'received', time, amount: '1', unit: 'X', failed: false, net: '' });
  const m = mergeFeed([mk('a', 10), mk('b', 30)], [mk('c', 20, 'sol'), mk('a', 10), mk('w', 0, 'eth')]);
  assert.deepEqual(m.map((x) => x.id), ['w', 'b', 'c', 'a']);
});

test('feed: filter by coin and by kind together', () => {
  const mk = (id: string, coin: FeedItem['coin'], kind: FeedItem['kind']): FeedItem => ({ id, coin, kind, time: 1, amount: '1', unit: 'X', failed: false, net: '' });
  const l = [mk('1', 'btc', 'received'), mk('2', 'btc', 'sent'), mk('3', 'eth', 'self'), mk('4', 'lyx', 'mined')];
  assert.equal(filterFeed(l, 'all', 'all').length, 4);
  assert.deepEqual(filterFeed(l, 'btc', 'all').map((x) => x.id), ['1', '2']);
  assert.deepEqual(filterFeed(l, 'all', 'sent').map((x) => x.id), ['2', '3']);
  assert.deepEqual(filterFeed(l, 'lyx', 'mined').map((x) => x.id), ['4']);
});
