import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Evm, fixtures } from './helpers/evm.ts';
const A = '0x00000000000000000000000000000000000000a1' as const;
test('evm: deploys the real contracts', async () => {
  const e = await Evm.create();
  await e.fund(A, 10n ** 20n);
  const f = await e.deploy(A, 'SafeProxyFactory');
  assert.ok((await e.code(f)).length > 100);
  const t = await e.deploy(A, 'MockUSDC');
  assert.equal(await e.call(A, t, fixtures.MockUSDC.abi, 'decimals'), 6);
});
