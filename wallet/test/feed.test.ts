import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btcItems, ethItems, filterFeed, isWaiting, landed, mergeFeed, nameIn, solItems, trxItems, type FeedItem } from '../src/lib/feed-core.ts';
import { parseEthTxs } from '../src/lib/multichain-core.ts';

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

test('feed: a payment the network already has in a block is not waiting, whatever the list says', () => {
  const held: FeedItem = { id: 'eth:sepolia:0xabc', coin: 'eth', kind: 'sent', time: 0, amount: '0.01', unit: 'ETH', failed: false, net: 'Sepolia' };
  assert.equal(isWaiting(held), true);
  assert.equal(isWaiting(held, {}), true);
  assert.equal(isWaiting(held, { block: 12170084 }), false);
  assert.equal(isWaiting({ ...held, time: 5 }), false);
  assert.equal(isWaiting({ ...held, failed: true }), false);
});

test('feed: a held payment that lands gets the block time, and keeps everything else', () => {
  const held: FeedItem = { id: 'eth:sepolia:0xabc', coin: 'eth', kind: 'sent', time: 0, amount: '0.01', unit: 'ETH', failed: false, other: '0x3601', net: 'Sepolia' };
  assert.equal(landed(held, {}), held, 'not in a block yet: unchanged');
  const l = landed(held, { block: 9, time: 1000 });
  assert.deepEqual([l.time, l.other, l.amount], [1000, '0x3601', '0.01']);
  assert.equal(landed(held, { block: 9 }, 77).time, 77, 'no block time known: use now');
  const done = { ...held, time: 50 };
  assert.equal(landed(done, { block: 9, time: 1000 }), done);
});

test('feed: your own shared account is called by its name, in any letter case', () => {
  const list = [{ address: '0x3601901fC0C87eEEf445381B0349852344868b73', name: 'Family' }];
  assert.equal(nameIn(list, '0x3601901fc0c87eeef445381b0349852344868b73'), 'Family');
  assert.equal(nameIn(list, '0xdead'), undefined);
  assert.equal(nameIn(list, undefined), undefined);
});

test('feed: Ethereum rows say who is on the other side', () => {
  const me = '0xAbC0000000000000000000000000000000000001';
  const a = '0x0000000000000000000000000000000000000002';
  const rows = parseEthTxs({ items: [
    { hash: '0x1', from: { hash: me }, to: { hash: a }, value: '5', status: 'ok', result: 'success', timestamp: '2026-11-16T10:00:00Z' },
    { hash: '0x2', from: { hash: a }, to: { hash: me }, value: '7', status: 'ok', result: 'success', timestamp: '2026-11-16T11:00:00Z' },
  ] }, me, 'ETH');
  assert.deepEqual(rows.map((r) => r.other), [a, a]);
  assert.equal(ethItems('sepolia', rows)[0].other, a);
});
