import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountOf, changeText, marketsUrl, money, parseMarkets, portfolio } from '../src/lib/prices-core.ts';

const feed = [
  { id: 'bitcoin', current_price: 100000, price_change_percentage_24h: 2, sparkline_in_7d: { price: [90000, 95000, 100000] } },
  { id: 'tether', current_price: 1, price_change_percentage_24h: 0, sparkline_in_7d: { price: [1, 1, 1] } },
  { id: 'junk', current_price: 'x' },
];

test('the feed is read into quotes and bad rows are dropped', () => {
  const q = parseMarkets(feed);
  assert.deepEqual(Object.keys(q).sort(), ['bitcoin', 'tether']);
  assert.equal(q.bitcoin.price, 100000);
  assert.deepEqual(parseMarkets(null), {});
  assert.deepEqual(parseMarkets({ error: 'rate limited' }), {});
});

test('the total, the 24 hour change and the week line', () => {
  const p = portfolio([{ symbol: 'BTC', amount: 0.01 }, { symbol: 'USDT', amount: 50 }, { symbol: 'LYX', amount: 999 }], parseMarkets(feed));
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0].symbol, 'BTC');
  assert.ok(Math.abs(p.total - 1050) < 1e-9);
  assert.ok(Math.abs(p.change - (1000 - 1000 / 1.02)) < 1e-9);
  assert.ok(p.pct > 1.8 && p.pct < 2);
  assert.deepEqual(p.series.map((x) => Math.round(x)), [950, 1000, 1050]);
});

test('the same coin on several chains is one line', () => {
  const p = portfolio([{ symbol: 'USDT', amount: 10 }, { symbol: 'USDT', amount: 5 }], parseMarkets(feed));
  assert.equal(p.lines.length, 1);
  assert.equal(p.total, 15);
});

test('nothing held, or no price yet, gives an empty portfolio', () => {
  assert.equal(portfolio([], {}).total, 0);
  assert.equal(portfolio([{ symbol: 'BTC', amount: 1 }], {}).lines.length, 0);
  assert.equal(portfolio([{ symbol: 'BTC', amount: 0 }], parseMarkets(feed)).lines.length, 0);
});

test('balances shown on screen read back as numbers', () => {
  assert.equal(amountOf('1,204.5'), 1204.5);
  assert.equal(amountOf(''), 0);
  assert.equal(amountOf('–'), 0);
});

test('money is written the way people read it', () => {
  assert.equal(money(1248.6, 'usd'), '$ 1,248.60');
  assert.equal(money(104300.4, 'inr'), '₹ 1,04,300');
  assert.equal(money(1248.6, 'inr'), '₹ 1,248.60');
  assert.equal(money(12345.5, 'inr'), '₹ 12,345.50');
  assert.equal(money(-3, 'usd'), '−$ 3.00');
  assert.equal(changeText(38.2, 3.14, 'usd'), '▲ $ 38.20 · 3.1% today');
  assert.equal(changeText(-5, -0.5, 'usd'), '▼ $ 5.00 · 0.5% today');
});

test('the feed address names each coin once', () => {
  const u = marketsUrl(['tether', 'bitcoin', 'tether'], 'inr');
  assert.ok(u.includes('vs_currency=inr') && u.includes('ids=bitcoin,tether&'));
});
