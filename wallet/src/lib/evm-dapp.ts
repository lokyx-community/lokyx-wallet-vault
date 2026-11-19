// Signing for Ethereum websites. The key comes from the recovery words for one signature and is dropped.

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { withEthKey } from './multichain';

/** personal_sign: the message is the hex the page sent (or its text), signed as an Ethereum message. */
export async function signPersonal(message: string, index = 0): Promise<Hex> {
  return withEthKey(async (sk) => {
    const acct = privateKeyToAccount(sk);
    return acct.signMessage({ message: /^0x([0-9a-fA-F]{2})*$/.test(message) ? { raw: message as Hex } : message });
  }, index);
}

/** eth_signTypedData_v4: the page's JSON, signed as typed data. Returns null when the JSON is not usable. */
export async function signTyped(json: string, index = 0): Promise<Hex | null> {
  let t: { domain?: Record<string, unknown>; types?: Record<string, { name: string; type: string }[]>; primaryType?: string; message?: Record<string, unknown> };
  try {
    t = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  if (!t?.types || !t.primaryType || !t.message) return null;
  const { EIP712Domain: _drop, ...types } = t.types;
  void _drop;
  return withEthKey(async (sk) => privateKeyToAccount(sk).signTypedData({ domain: t.domain ?? {}, types, primaryType: t.primaryType!, message: t.message! } as never), index);
}
