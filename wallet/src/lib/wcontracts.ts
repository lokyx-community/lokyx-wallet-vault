// Making and calling the wallet's own contracts (multisig, offer board, token lock): estimate gas with the
// node, have it encode the arguments from the ABI, sign with this phone's key, and note it as pending.

import { base64 } from '@scure/base';
import { bytesToHex, hexToBytes } from './lokyx';
import { rpc, type GasEstimate, type RunResult } from './rpc';
import { currentAddress, sendContract } from './wallet';
import { addPending } from './data';
import { BOARD_ABI, BOARD_WASM, MULTISIG_ABI, MULTISIG_WASM, TOKENLOCK_ABI, TOKENLOCK_WASM } from './contracts-wallet';

export const KINDS = {
  multisig: { code: base64.decode(MULTISIG_WASM), abi: MULTISIG_ABI },
  board: { code: base64.decode(BOARD_WASM), abi: BOARD_ABI },
  tokenlock: { code: base64.decode(TOKENLOCK_WASM), abi: TOKENLOCK_ABI },
};
export type Kind = keyof typeof KINDS;

/** Deploy one. `value` (in base units) goes into the new contract's balance. Returns the transaction hash. */
export async function deploy(kind: Kind, args: unknown[], value = 0n, label = ''): Promise<string> {
  const { code, abi } = KINDS[kind];
  const g = await rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), code: bytesToHex(code), abi, args, value: value.toString() });
  if (!g.ok) throw new Error(g.error ?? "It can't be made");
  const input = await rpc<string>('lyx_encodeDeploy', { abi, args });
  const h = await sendContract({ kind: 'deploy', code, abi, input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(g.gasLimit) }, '', value);
  await addPending({ hash: h, from: currentAddress(), to: '', amount: label, what: 'deploy', at: Date.now() });
  return h;
}

/** Call a method that changes something. Throws the contract's own words when it would fail. */
export async function callMethod(to: string, method: string, args: unknown[] = [], value = 0n, label = ''): Promise<string> {
  const g = await rpc<GasEstimate>('lyx_estimateGas', { from: currentAddress(), to, method, args, value: value.toString() });
  if (!g.ok) throw new Error(g.error ?? "That can't be done right now");
  const input = await rpc<string>('lyx_encodeCall', { to, method, args });
  const h = await sendContract({ kind: 'call', input: hexToBytes(input.replace(/^0x/, '')), gas: BigInt(g.gasLimit) }, to, value);
  await addPending({ hash: h, from: currentAddress(), to, amount: label, what: 'call', at: Date.now() });
  return h;
}

/** Read without a transaction. */
export async function view<R>(to: string, method: string, args: unknown[] = []): Promise<R> {
  const r = await rpc<RunResult>('lyx_call', { to, method, args });
  if (!r.ok) throw new Error(r.error ?? 'The contract refused');
  return r.result as R;
}
