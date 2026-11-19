import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalFor, buildQuoteUrl, checkQuote, LIFI, NATIVE, ourFee, parseQuote, parseStatus, SOLANA_ID, statusUrl, type LifiConfig, type QuoteRequest } from '../src/lib/lifi-core.ts';

// The quote below is shaped after LI.FI's published reference for GET /v1/quote. It is not a recording of the live
// service (this machine cannot reach li.quest), so the numbers are made up; only the field names and nesting matter.
const ME = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x2222222222222222222222222222222222222222';
const EVIL = '0x3333333333333333333333333333333333333333';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const cfg: LifiConfig = { ...LIFI, integrator: 'lokyx', routers: { 8453: [ROUTER], 1: [ROUTER] } };
const req: QuoteRequest = { fromChain: 8453, toChain: 42161, fromToken: USDC_BASE, toToken: USDC_ARB, fromAddress: ME, fromAmount: 100_000_000n };

const quote = (o: Record<string, any> = {}) => ({
  id: 'x',
  type: 'lifi',
  tool: 'across',
  toolDetails: { key: 'across', name: 'Across' },
  action: { fromChainId: 8453, toChainId: 42161, fromToken: { address: USDC_BASE }, toToken: { address: USDC_ARB }, fromAmount: '100000000', slippage: 0.005, fromAddress: ME, toAddress: ME },
  estimate: {
    fromAmount: '100000000',
    toAmount: '99400000',
    toAmountMin: '98900000',
    approvalAddress: ROUTER,
    executionDuration: 30,
    fromAmountUSD: '100.00',
    toAmountUSD: '99.40',
    feeCosts: [{ name: 'Bridge fee', percentage: '0.003', token: { address: USDC_BASE }, amount: '300000', amountUSD: '0.30', included: true }],
  },
  transactionRequest: { from: ME, to: ROUTER, chainId: 8453, data: '0xdeadbeef', value: '0x0', gasLimit: '0x30d40' },
  ...o,
});
const run = (q: unknown, r = req, c = cfg) => {
  const p = parseQuote(q);
  assert.ok(p.ok, p.ok ? '' : p.why);
  return checkQuote(p.q, r, c);
};
const stops = (q: unknown, r = req, c = cfg) => run(q, r, c).checks.filter((x) => x.level === 'stop').map((x) => x.id);

test('a good quote passes every check', () => {
  const v = run(quote());
  assert.equal(v.level, 'pass', JSON.stringify(v.checks.filter((x) => x.level !== 'pass')));
  assert.ok(v.checks.length >= 10);
});

test('the request URL: addresses only, own fee only when on, never above the cap', () => {
  const u = new URL(buildQuoteUrl(req, cfg));
  assert.equal(u.origin + u.pathname, 'https://li.quest/v1/quote');
  assert.equal(u.searchParams.get('fromAmount'), '100000000');
  assert.equal(u.searchParams.get('toAddress'), ME); // defaults to your own address
  assert.equal(u.searchParams.get('integrator'), 'lokyx');
  assert.equal(u.searchParams.get('fee'), null); // this build adds none
  assert.equal(new URL(buildQuoteUrl(req, { ...cfg, feeBps: 50 })).searchParams.get('fee'), '0.005');
  assert.throws(() => buildQuoteUrl(req, { ...cfg, feeBps: 101 }));
  assert.throws(() => buildQuoteUrl({ ...req, fromToken: 'USDC' })); // a symbol is how a fake token gets in
  assert.throws(() => buildQuoteUrl({ ...req, fromAmount: 0n }));
});

test('a quote that sends the result to someone else is stopped', () => {
  const q = quote();
  q.action.toAddress = EVIL;
  assert.ok(stops(q).includes('receiver'));
});

test('a quote for different coins, chains or amounts than asked is stopped', () => {
  const a = quote();
  a.action.toToken = { address: EVIL };
  assert.ok(stops(a).includes('coins'));
  const b = quote();
  b.action.toChainId = 1;
  assert.ok(stops(b).includes('route'));
  const c = quote();
  c.action.fromAmount = '900000000';
  assert.ok(stops(c).includes('amount'));
  const d = quote();
  d.transactionRequest.chainId = 1;
  assert.ok(stops(d).includes('chain-id'));
});

test('a transaction to a contract that is not pinned is stopped, and with nothing pinned every swap is off', () => {
  const q = quote();
  q.transactionRequest.to = EVIL;
  assert.ok(stops(q).includes('router'));
  const r = quote();
  r.estimate.approvalAddress = EVIL;
  assert.ok(stops(r).includes('approval'));
  assert.ok(stops(quote(), req, { ...cfg, routers: {} }).includes('router'));
  assert.equal(run(quote(), req, { ...cfg, routers: {} }).level, 'stop');
});

test('the transaction cannot send more than the amount shown', () => {
  const t = quote();
  t.transactionRequest.value = '0x1'; // a token swap with ether attached
  assert.ok(stops(t).includes('value'));
  // paying in the chain's own coin: the value must be the amount
  const nreq: QuoteRequest = { ...req, fromToken: NATIVE, fromAmount: 10n ** 18n };
  const n = quote();
  n.action.fromToken = { address: NATIVE };
  n.action.fromAmount = (10n ** 18n).toString();
  n.estimate.fromAmount = (10n ** 18n).toString();
  n.transactionRequest.value = '0x' + (10n ** 18n).toString(16);
  assert.equal(stops(n, nreq).includes('value'), false);
  n.transactionRequest.value = '0x' + (2n * 10n ** 18n).toString(16);
  assert.ok(stops(n, nreq).includes('value'));
  n.transactionRequest.value = '0x' + (5n * 10n ** 17n).toString(16); // less than the amount: not what was shown
  assert.ok(stops(n, nreq).includes('value'));
});

test('a minimum far below the quote, a missing minimum, and big fees are stopped', () => {
  const a = quote();
  a.estimate.toAmountMin = '50000000';
  assert.ok(stops(a).includes('slippage'));
  const b = quote();
  b.estimate.toAmountMin = '0';
  assert.ok(stops(b).includes('min'));
  const c = quote();
  c.estimate.feeCosts.push({ name: 'Mystery', percentage: '0.08', token: { address: USDC_BASE }, amount: '8000000', amountUSD: '8', included: true });
  assert.ok(stops(c).includes('fees'));
});

test('a price much worse than the market is stopped; no market price asks for a tick', () => {
  const a = quote();
  a.estimate.toAmountUSD = '90.00';
  assert.ok(stops(a).includes('price'));
  const b = quote();
  delete (b.estimate as any).toAmountUSD;
  const v = run(b);
  assert.equal(v.level, 'warn');
  assert.equal(v.checks.find((x) => x.id === 'price')?.level, 'warn');
});

test('Solana is refused until the wallet can read its transactions', () => {
  assert.ok(stops(quote(), { ...req, toChain: SOLANA_ID }).includes('chain'));
});

test('unreadable or incomplete answers are refusals, never defaults', () => {
  assert.equal(parseQuote(null).ok, false);
  assert.equal(parseQuote({}).ok, false);
  const noTx = quote();
  delete (noTx as any).transactionRequest;
  assert.equal(parseQuote(noTx).ok, false);
  const bad = quote();
  bad.estimate.toAmount = 'lots';
  assert.equal(parseQuote(bad).ok, false);
  const noAddr = quote();
  noAddr.transactionRequest.to = 'router';
  assert.equal(parseQuote(noAddr).ok, false);
  const noData = quote();
  noData.transactionRequest.data = 'zz';
  assert.equal(parseQuote(noData).ok, false);
});

test('the approval the wallet builds is the exact amount, to the pinned contract', () => {
  const p = parseQuote(quote());
  assert.ok(p.ok);
  assert.deepEqual(approvalFor(p.q), { token: USDC_BASE, spender: ROUTER, amount: 100_000_000n });
  const n = quote();
  n.action.fromToken = { address: NATIVE };
  const pn = parseQuote(n);
  assert.ok(pn.ok);
  assert.equal(approvalFor(pn.q), null);
});

test('the fee line: what the wallet asked for, shown in USD', () => {
  const p = parseQuote(quote());
  assert.ok(p.ok);
  assert.deepEqual(ourFee(p.q, { ...cfg, feeBps: 50 }), { bps: 50, usd: 0.5 });
  assert.deepEqual(ourFee(p.q, cfg), { bps: 0, usd: 0 });
});

test('status: only a finished, completed swap is "done"; anything unknown is still pending', () => {
  assert.equal(parseStatus({ status: 'DONE', substatus: 'COMPLETED' }), 'done');
  assert.equal(parseStatus({ status: 'DONE', substatus: 'PARTIAL' }), 'partial');
  assert.equal(parseStatus({ status: 'DONE', substatus: 'REFUNDED' }), 'refunded');
  assert.equal(parseStatus({ status: 'DONE' }), 'pending');
  assert.equal(parseStatus({ status: 'FAILED' }), 'failed');
  assert.equal(parseStatus({ status: 'NOT_FOUND' }), 'not-found');
  assert.equal(parseStatus({ status: 'PENDING' }), 'pending');
  assert.equal(parseStatus({ status: 'SOMETHING_NEW' }), 'pending');
  assert.equal(parseStatus(null), 'pending');
  assert.throws(() => statusUrl('0x12', 1, 2));
  assert.match(statusUrl('0x' + 'a'.repeat(64), 1, 8453), /fromChain=1&toChain=8453$/);
});
