import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeData, evmKind, isEvmMethod, messageText, quantity, toChainId, EVM_PROVIDER_JS } from '../src/lib/evm-dapp-core.ts';

test('requests are sorted: reads pass through, signing and sending are asked about, the rest refused', () => {
  assert.equal(evmKind('eth_call'), 'read');
  assert.equal(evmKind('eth_requestAccounts'), 'connect');
  assert.equal(evmKind('eth_sendTransaction'), 'send');
  assert.equal(evmKind('personal_sign'), 'sign');
  assert.equal(evmKind('eth_signTypedData_v4'), 'typed');
  assert.equal(evmKind('wallet_switchEthereumChain'), 'switch');
  assert.equal(evmKind('eth_sign'), 'no'); // blind signing is never offered
  assert.equal(evmKind('eth_getEncryptionPublicKey'), 'no');
  assert.equal(evmKind('lyx_requestAccounts'), null); // the LOKYX-chain provider's own calls are not ours
  assert.equal(isEvmMethod('lyx_sendTransaction'), false);
});

test('chain ids and quantities are read strictly', () => {
  assert.equal(toChainId('0x14a34'), 84532);
  assert.equal(toChainId('84532'), null);
  assert.equal(toChainId(5), null);
  assert.equal(quantity('0x'), 0n);
  assert.equal(quantity(undefined), 0n);
  assert.equal(quantity('0xde0b6b3a7640000'), 10n ** 18n);
  assert.equal(quantity('1000'), null);
});

test('a message that is text is shown as text, anything else as the hex it is', () => {
  assert.deepEqual(messageText('0x48656c6c6f'), { text: 'Hello', plain: true });
  assert.deepEqual(messageText('0xff00ff'), { text: '0xff00ff', plain: false });
});

test('an unlimited token approval is recognised', () => {
  const spender = '1111111111111111111111111111111111111111';
  const max = 'f'.repeat(64);
  const d = describeData(`0x095ea7b3${'0'.repeat(24)}${spender}${max}`);
  assert.equal(d.kind, 'approve');
  assert.equal(d.spender, `0x${spender}`);
  assert.equal(d.unlimited, true);
  const small = describeData(`0x095ea7b3${'0'.repeat(24)}${spender}${'0'.repeat(63)}5`);
  assert.equal(small.unlimited, false);
  assert.equal(small.amount, 5n);
  assert.deepEqual(describeData('0x'), { kind: 'none', bytes: 0 });
  assert.equal(describeData('0xa9059cbb00').kind, 'other');
});

test('the page script is valid JavaScript and announces itself', () => {
  new Function(EVM_PROVIDER_JS.replace(/^\(function/, 'return (function'));
  assert.match(EVM_PROVIDER_JS, /eip6963:announceProvider/);
  assert.match(EVM_PROVIDER_JS, /isLokyx: true/);
});
