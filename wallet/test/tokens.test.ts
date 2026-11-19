import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'viem';
import { parsePayload, tokenRequestUri } from '../src/lib/scan-core.ts';
import { KNOWN_TOKENS, searchKnown } from '../src/lib/multichain-core.ts';

const me = '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0';
const usdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

test('token list: every contract is written with its checksum, one entry per token and chain', () => {
  for (const t of KNOWN_TOKENS) assert.equal(getAddress(t.contract), t.contract, t.symbol);
  const ids = KNOWN_TOKENS.map((t) => `${t.chainId}:${t.contract.toLowerCase()}`);
  assert.equal(new Set(ids).size, ids.length);
});

test('token search: by symbol or name, only on the chain asked, nothing for an empty query', () => {
  assert.deepEqual(searchKnown(1, 'usd').map((t) => t.symbol).sort(), ['USDC', 'USDT']);
  assert.deepEqual(searchKnown(1, 'teth').map((t) => t.symbol), ['USDT']);
  assert.deepEqual(searchKnown(1, 'chain').map((t) => t.symbol), ['LINK']);
  assert.deepEqual(searchKnown(11155111, 'usdt'), []);
  assert.deepEqual(searchKnown(1, '  '), []);
});

test('token request: an amount becomes an EIP-681 transfer; no amount is just the address', () => {
  assert.equal(tokenRequestUri({ contract: usdc, decimals: 6, to: me, chainId: 11155111 }), me);
  assert.equal(tokenRequestUri({ contract: usdc, decimals: 6, to: me, amount: '12.5', chainId: 11155111 }), `ethereum:${usdc}@11155111/transfer?address=${me}&uint256=12500000`);
  assert.throws(() => tokenRequestUri({ contract: usdc, decimals: 6, to: me, amount: '1.1234567', chainId: 1 }));
});

test('scan: a token request pays the person named in it, never the token contract', () => {
  const uri = tokenRequestUri({ contract: usdc, decimals: 6, to: me, amount: '12.5', chainId: 11155111 });
  assert.deepEqual(parsePayload(uri), { address: me, how: 'qr', chain: 'eth', token: usdc, units: '12500000' });
  // without an amount, or with a zero one
  assert.deepEqual(parsePayload(`ethereum:${usdc}/transfer?address=${me}`), { address: me, how: 'qr', chain: 'eth', token: usdc });
  assert.deepEqual(parsePayload(`ethereum:${usdc}/transfer?address=${me}&uint256=0`), { address: me, how: 'qr', chain: 'eth', token: usdc });
  // no person to pay, or a function other than transfer: not a payment
  assert.equal(parsePayload(`ethereum:${usdc}/transfer?uint256=5`), null);
  assert.equal(parsePayload(`ethereum:${usdc}/approve?address=${me}&uint256=5`), null);
});

test('networks: test networks are always offered, mainnet only when allowed, and each has its own explorer and chain id', async () => {
  const { ETH_NETS, ethNetChoices } = await import('../src/lib/multichain-core.ts');
  assert.ok(ethNetChoices(false).every((n) => !ETH_NETS[n].real));
  assert.deepEqual(ethNetChoices(false).slice(0, 3), ['sepolia', 'base-sepolia', 'arbitrum-sepolia']);
  assert.ok(ethNetChoices(true).includes('mainnet') && ethNetChoices(true).includes('polygon') && ethNetChoices(true).length > ethNetChoices(false).length);
  const ids = Object.values(ETH_NETS).map((n) => n.chainId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(searchKnown(ETH_NETS['base-sepolia'].chainId, 'usdc').length, 1);
  assert.equal(searchKnown(ETH_NETS['arbitrum-sepolia'].chainId, 'usdc').length, 1);
});
