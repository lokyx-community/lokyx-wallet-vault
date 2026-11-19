// Builds a real vault on the local EVM: the audited contracts installed at their canonical addresses, then the
// vault created and activated exactly as the wallet does it.

import { keccak256, toHex, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { Evm, fixtures } from './evm.ts';
import {
  ABI, CONTRACTS, activationTx, creationCalls, deploymentOf, execTransactionData, safeTxHash, signAction, signHash, submission, vaultAddresses, DEFAULT_WAIT, ETH, EXPIRY, ZODIAC_ADVISORY,
  type Deployment, type Reader, type SafeTx, type SignedAction, type VaultSettings, type VaultPlan, type Expected,
} from '../../src/lib/ethvault-core.ts';

void ZODIAC_ADVISORY;
export const KEYS = {
  recovery: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex,
  phone: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex,
  thief: '0x3333333333333333333333333333333333333333333333333333333333333333' as Hex,
  helper: '0x4444444444444444444444444444444444444444444444444444444444444444' as Hex,
  safeDest: '0x5555555555555555555555555555555555555555555555555555555555555555' as Hex,
  friend: '0x6666666666666666666666666666666666666666666666666666666666666666' as Hex,
};
export const ADDR = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v).address])) as Record<keyof typeof KEYS, Hex>;
export const CHAIN_ID = 84532;
export const ETH1 = 10n ** 18n;
export const USDC = (n: number) => BigInt(n) * 10n ** 6n;

const ONE = '0x0000000000000000000000000000000000000001' as Hex;

async function installAt(evm: Evm, addr: Hex, name: string, ctor?: unknown[]) {
  const tmp = await evm.deploy(ADDR.helper, name, ctor ? { args: ctor } : {});
  // contracts with immutables (MultiSend) embed their own address: rewrite it to the canonical one, so the code
  // is exactly what is deployed there
  const code = await evm.code(tmp);
  const fixed = code.split(tmp.slice(2).toLowerCase()).join(addr.slice(2).toLowerCase()) as Hex;
  await evm.vm.stateManager.putCode(createAddressFromString(addr), hexToBytes(fixed));
}

export interface World {
  evm: Evm;
  d: Deployment;
  plan: VaultPlan;
  a: ReturnType<typeof vaultAddresses>;
  usdc: Hex;
  usdt: Hex;
  settings: VaultSettings;
  expected: Expected;
  reader: Reader;
  submit(from: Hex, act: SignedAction): ReturnType<Evm['raw']>;
  safeNonce(): Promise<bigint>;
}

export async function installContracts(evm: Evm) {
  const d = deploymentOf();
  await installAt(evm, d.safeSingleton, 'SafeL2');
  await installAt(evm, d.safeProxyFactory, 'SafeProxyFactory');
  await installAt(evm, d.multiSend, 'MultiSend');
  await installAt(evm, d.multiSendCallOnly, 'MultiSendCallOnly');
  await installAt(evm, d.fallbackHandler, 'CompatibilityFallbackHandler');
  await installAt(evm, d.allowanceModule, 'AllowanceModule');
  await installAt(evm, d.delayMastercopy, 'Delay', [ONE, ONE, ONE, 86400n, 604800n]);
  // Roles v1 links the Permissions library: deploy it and link its address into the Roles bytecode
  const lib = await evm.deploy(ADDR.helper, 'RolesPermissions');
  const linked = fixtures.Roles.bytecode.replace(/__\$[0-9a-f]{34}\$__/g, lib.slice(2).toLowerCase()) as Hex;
  const saved = fixtures.Roles.bytecode;
  fixtures.Roles.bytecode = linked;
  await installAt(evm, d.rolesMastercopy, 'Roles', [ONE, ONE, ONE]);
  fixtures.Roles.bytecode = saved;
  await installAt(evm, d.moduleProxyFactory, 'ModuleProxyFactory');
  return d;
}

/** `lock: false` builds the older vault whose recovery key is still the Safe's owner, to play a holder of an owner key in config-check tests. */
export async function makeWorld(opts: { wait?: number; ethAllowance?: bigint; usdcAllowance?: bigint; fundSafe?: boolean; lock?: boolean; gated?: boolean } = {}): Promise<World> {
  const evm = await Evm.create();
  for (const k of Object.values(ADDR)) await evm.fund(k, 100n * ETH1);
  const d = await installContracts(evm);
  const plan: VaultPlan = { recovery: ADDR.recovery, phone: ADDR.phone, safeAddress: ADDR.safeDest };
  const a = vaultAddresses(plan, d);
  const usdc = await evm.deploy(ADDR.helper, 'MockUSDC');
  const usdt = await evm.deploy(ADDR.helper, 'MockUSDT');
  const settings: VaultSettings = {
    wait: opts.wait ?? DEFAULT_WAIT,
    allowances: [
      { token: ETH, symbol: 'ETH', decimals: 18, amount: opts.ethAllowance ?? ETH1 / 10n },
      { token: usdc, symbol: 'USDC', decimals: 6, amount: opts.usdcAllowance ?? USDC(100) },
      { token: usdt, symbol: 'USDT', decimals: 6, amount: USDC(50) },
    ],
  };
  // 1. create the Safe and the two module proxies (anyone can; the phone does)
  const gated = opts.gated !== false;
  for (const c of creationCalls(plan, d, gated)) {
    const r = await evm.raw(ADDR.phone, c.to, c.data!);
    if (!r.ok) throw new Error(`creation call failed: ${r.error}`);
  }
  if ((await evm.code(a.safe)) === '0x' || (await evm.code(a.delay)) === '0x' || (await evm.code(a.roles)) === '0x' || (gated && (await evm.code(a.gate)) === '0x')) throw new Error('predicted addresses do not match the deployed ones');
  if (opts.fundSafe !== false) {
    await evm.fund(a.safe, 5n * ETH1);
    await evm.call(ADDR.helper, usdc, fixtures.MockUSDC.abi, 'mint', [a.safe, USDC(10_000)]);
    await evm.call(ADDR.helper, usdt, fixtures.MockUSDT.abi, 'mint', [a.safe, USDC(10_000)]);
  }
  const reader: Reader = {
    async call(to, data) {
      const r = await evm.raw(ADDR.helper, to, data);
      if (!r.ok) throw new Error(`call reverted: ${r.error}`);
      return r.data;
    },
    code: (addr) => evm.code(addr),
  };
  const submit = (from: Hex, act: SignedAction) => {
    const s = submission(act);
    return evm.raw(from, s.to, s.data);
  };
  const safeNonce = async () => evm.call<bigint>(ADDR.helper, a.safe, ABI.safe, 'nonce');
  // 2. activate: one Safe transaction signed by the recovery key
  const lock = opts.lock !== false;
  const tx = activationTx(plan, settings, d, await safeNonce(), lock, gated);
  const act = await signAction(KEYS.recovery, CHAIN_ID, a.safe, 'cancel', tx, 'activate');
  const r = await submit(ADDR.helper, act);
  if (!r.ok) throw new Error(`activation reverted: ${r.error} ${r.data}`);
  const expected: Expected = { safe: a.safe, delay: a.delay, roles: a.roles, phone: ADDR.phone, recovery: ADDR.recovery, wait: settings.wait, allowances: settings.allowances, deployment: d, ...(lock ? {} : { legacyOwner: true }), ...(gated ? { gate: a.gate } : {}) };
  return { evm, d, plan, a, usdc, usdt, settings, expected, reader, submit, safeNonce };
}

export { CONTRACTS, execTransactionData, safeTxHash, signHash, EXPIRY, zeroAddress, keccak256, toHex, hexToBytes };
export type { SafeTx };
