// The phone side of signing-core.ts: the on/off switch kept on the phone, and the judging of a request from a website.

import { getItem, setItem } from './kv';
import { store, useStore } from './store';
import { resetHooks } from './wallet';
import { contacts, recent } from './data';
import { ethCode } from './multichain';
import { ETH_NETS, KNOWN_TOKENS, type EthNet } from './multichain-core';
import { assess, cancelOff, decodeRequest, DEFAULT_PROTECTION, partiesOf, protectionActive, requestOff, shortAddr, type Assessment, type Code, type Protection, type Request } from './signing-core';

const KEY = 'w.signprot';

export const signingProtection = store<Protection>(DEFAULT_PROTECTION);
export const useSigningProtection = () => useStore(signingProtection);

export async function loadSigning() {
  try {
    signingProtection.set((JSON.parse((await getItem(KEY)) ?? 'null') as Protection | null) ?? DEFAULT_PROTECTION);
  } catch {
    signingProtection.set(DEFAULT_PROTECTION);
  }
}
resetHooks.push(() => signingProtection.set(DEFAULT_PROTECTION));

const save = () => setItem(KEY, JSON.stringify(signingProtection.get()));

/** Turning it on again is instant. Turning it off starts the 24 hour wait. */
export async function askSigningOff(now = Date.now()) {
  signingProtection.set(requestOff(signingProtection.get(), now));
  await save();
}
export async function keepSigningOn() {
  signingProtection.set(cancelOff(signingProtection.get()));
  await save();
}

/** Look at a request before the person sees it. Never throws: a lookup that fails counts as "unknown". */
export async function judgeRequest(req: Request, net: EthNet, own: string[], now = Date.now()): Promise<Assessment> {
  const decoded = decodeRequest(req);
  const known = [...contacts.get().map((c) => c.address), ...recent.get(), ...own].map((a) => a.toLowerCase());
  const code: Record<string, Code> = {};
  await Promise.all(
    partiesOf(decoded).map(async (a) => {
      try {
        code[a.toLowerCase()] = (await ethCode(net, a)) === '0x' ? 'none' : 'contract';
      } catch {
        code[a.toLowerCase()] = 'unknown';
      }
    }),
  );
  const chainId = ETH_NETS[net].chainId;
  const tokenName = (t?: string) => {
    if (!t) return 'your tokens';
    const k = KNOWN_TOKENS.find((x) => x.chainId === chainId && x.contract.toLowerCase() === t.toLowerCase());
    return k ? k.symbol : shortAddr(t);
  };
  return assess(req, decoded, { now, protectionOn: protectionActive(signingProtection.get(), now), known, code, tokenName });
}
