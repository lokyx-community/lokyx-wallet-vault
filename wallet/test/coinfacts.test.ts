import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, aboutFrom, factsFor } from '../src/lib/coinfacts.ts';
import { infoPath, infoUrl, type CoinInfo } from '../src/lib/coininfo-core.ts';
import { PRICED, marketsPath, marketsUrl } from '../src/lib/prices-core.ts';

test('every priced coin has built-in text, and every link is https', () => {
  for (const c of Object.values(PRICED)) assert.ok(FACTS[c.id]?.about, `${c.id} has no text`);
  for (const [id, f] of Object.entries(FACTS)) {
    assert.ok(f.about.length > 40 && f.about.length < 320, id);
    for (const l of f.links) assert.match(l.url, /^https:\/\/[^\s]+$/, `${id} ${l.label}`);
  }
  assert.ok(FACTS.lyx && /no market price/.test(FACTS.lyx.about));
});

test('live text wins, built-in text fills the gaps', () => {
  const live = { about: 'Live text.', links: [{ label: 'Website', url: 'https://live.example' }] } as CoinInfo;
  assert.equal(aboutFrom(live, factsFor('bitcoin')).about, 'Live text.');
  assert.equal(aboutFrom(live, factsFor('bitcoin')).links[0].url, 'https://live.example');
  const empty = { about: '', links: [] } as unknown as CoinInfo;
  assert.equal(aboutFrom(empty, factsFor('bitcoin')).about, FACTS.bitcoin.about);
  assert.equal(aboutFrom(null, factsFor('bitcoin')).links.length, 3);
  assert.deepEqual(aboutFrom(null, factsFor('nothing-here')), { about: '', links: [] });
});

test('the path is what the relay and CoinGecko both serve', () => {
  assert.equal(infoUrl('bitcoin'), `https://api.coingecko.com${infoPath('bitcoin')}`);
  assert.match(infoPath('usd-coin'), /^\/api\/v3\/coins\/usd-coin\?/);
  assert.equal(marketsUrl(['b', 'a', 'a'], 'usd'), `https://api.coingecko.com${marketsPath(['b', 'a', 'a'], 'usd')}`);
  assert.match(marketsPath(['b', 'a', 'a'], 'usd'), /ids=a,b&/);
});
