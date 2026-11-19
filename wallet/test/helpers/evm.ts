// A tiny local Ethereum for the vault tests: a real EVM (ethereumjs) running the real Safe, Allowance Module,
// Zodiac Delay (the official 1.0.1 creation code) and Roles v1 bytecode from test/fixtures. Calls are made "from"
// any address (no signatures needed at the transaction level, since this is a sandbox); Safe signatures are real.

import { readFileSync } from 'node:fs';
import { createCustomCommon, Mainnet } from '@ethereumjs/common';
import { createVM, runTx } from '@ethereumjs/vm';
import { createBlock } from '@ethereumjs/block';
import { createAccount, createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';
const Address = { fromString: createAddressFromString };
import { encodeDeployData, encodeFunctionData, decodeFunctionResult, type Abi, type Hex } from 'viem';

const fx = JSON.parse(readFileSync(new URL('./../fixtures/eth-vault-contracts.json', import.meta.url), 'utf8')) as Record<string, { abi: Abi; bytecode: Hex; officialAddress?: string }>;
export const fixtures = fx;

export class Evm {
  vm!: Awaited<ReturnType<typeof createVM>>;
  time = 1_800_000_000n;
  number = 1n;
  static async create() {
    const e = new Evm();
    e.vm = await createVM({ common: createCustomCommon({ chainId: 84532 }, Mainnet, { hardfork: 'cancun' }) });
    return e;
  }
  private block() {
    return createBlock({ header: { timestamp: this.time, number: this.number, gasLimit: 30_000_000n, baseFeePerGas: 0n } }, { common: this.vm.common, setHardfork: false });
  }
  async fund(addr: Hex, wei: bigint) {
    const a = Address.fromString(addr);
    const acc = (await this.vm.stateManager.getAccount(a)) ?? createAccount({});
    acc.balance = wei;
    await this.vm.stateManager.putAccount(a, acc);
  }
  /** Plant a storage word directly (simulates a tampered contract state the Safe itself would refuse to produce). */
  async setStorage(addr: Hex, slot: Hex, value: Hex) {
    const a = Address.fromString(addr);
    const pad = (h: string) => hexToBytes(('0x' + h.slice(2).padStart(64, '0')) as Hex);
    await this.vm.stateManager.putStorage(a, pad(slot), pad(value).filter((_, i, arr) => true));
  }
  async balance(addr: Hex): Promise<bigint> {
    return (await this.vm.stateManager.getAccount(Address.fromString(addr)))?.balance ?? 0n;
  }
  async code(addr: Hex): Promise<Hex> {
    return bytesToHex(await this.vm.stateManager.getCode(Address.fromString(addr))) as Hex;
  }
  /** Move the clock forward and mine a block number. */
  wait(seconds: number) {
    this.time += BigInt(seconds);
    this.number += 1n;
  }
  /** A raw call. Returns success, return data and gas used. Reverts leave no state behind. */
  async raw(from: Hex, to: Hex | undefined, data: Hex, value = 0n) {
    const r = await this.vm.evm.runCall({
      caller: Address.fromString(from),
      to: to ? Address.fromString(to) : undefined,
      data: hexToBytes(data),
      value,
      gasLimit: 25_000_000n,
      block: this.block(),
    });
    const ok = !r.execResult.exceptionError;
    return { ok, data: bytesToHex(r.execResult.returnValue) as Hex, gas: r.execResult.executionGasUsed, created: r.createdAddress ? (r.createdAddress.toString() as Hex) : undefined, error: r.execResult.exceptionError?.error };
  }
  async deploy(from: Hex, name: string, ctor: { types?: Abi; args?: unknown[] } = {}): Promise<Hex> {
    const f = fx[name];
    const data = ctor.args ? encodeDeployData({ abi: f.abi, bytecode: f.bytecode, args: ctor.args }) : f.bytecode;
    const r = await this.raw(from, undefined, data as Hex);
    if (!r.ok || !r.created) throw new Error(`deploy ${name} failed: ${r.error}`);
    return r.created;
  }
  /** A call that must succeed; returns the decoded result. */
  async call<T = unknown>(from: Hex, to: Hex, abi: Abi, fn: string, args: unknown[] = [], value = 0n): Promise<T> {
    const data = encodeFunctionData({ abi, functionName: fn, args } as never);
    const r = await this.raw(from, to, data, value);
    if (!r.ok) throw new Error(`${fn} reverted: ${r.error} ${r.data}`);
    try {
      return decodeFunctionResult({ abi, functionName: fn, data: r.data } as never) as T;
    } catch {
      return undefined as T;
    }
  }
  /** Like call, but returns whether it reverted instead of throwing. */
  async tryCall(from: Hex, to: Hex, abi: Abi, fn: string, args: unknown[] = [], value = 0n) {
    const data = encodeFunctionData({ abi, functionName: fn, args } as never);
    return this.raw(from, to, data, value);
  }
}
void runTx;
