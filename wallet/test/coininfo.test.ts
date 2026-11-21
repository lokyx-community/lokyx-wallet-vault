import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact, parseInfo, plainAbout } from '../src/lib/coininfo-core.ts';

test('about keeps two plain sentences', () => {
  assert.equal(plainAbout('<p>One <a href="x">coin</a>. Two! Three.</p>'), 'One coin. Two!');
  assert.equal(plainAbout(5), '');
});

test('info reads numbers and only https links', () => {
  const v = parseInfo({
    description: { en: 'Hello world.' },
    market_cap_rank: 1,
    market_data: { market_cap: { usd: 2e12 }, total_volume: { usd: 3e10 }, ath: { usd: 100 }, ath_change_percentage: { usd: -10.5 }, circulating_supply: 19.8e6, max_supply: 21e6 },
    links: { homepage: ['', 'http://bad', 'https://bitcoin.org'], blockchain_site: ['https://mempool.space'], whitepaper: 'javascript:alert(1)', twitter_screen_name: 'bitcoin' },
  }, 'usd');
  assert.equal(v?.rank, 1);
  assert.equal(v?.cap, 2e12);
  assert.equal(v?.athDrop, -10.5);
  assert.deepEqual(v?.links.map((l) => l.label), ['Website', 'Explorer', 'X']);
  assert.equal(parseInfo(null, 'usd'), null);
});

test('compact shortens big numbers', () => {
  assert.equal(compact(1.91e12, '$'), '$1.91T');
  assert.equal(compact(38.2e9, '$'), '$38.2B');
  assert.equal(compact(19.8e6), '19.8M');
  assert.equal(compact(950), '950');
});
