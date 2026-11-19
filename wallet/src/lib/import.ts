// The phone side of import-core.ts: looks for money in another wallet's Ethereum keys and moves it into this one.
// The words, passphrase and keys only live in the function calls below; nothing is saved.

import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { ethBalance, sweepEvm, tokenBalance } from './multichain';
import { ETH_NETS, KNOWN_TOKENS, type EthNet } from './multichain-core';
import { normalizeMnemonic } from './lokyx';
import { PATH_STYLES, onlyWithMoney, scanTargets, type FoundAddress, type Holding } from './import-core';

export type Source = { words: string; passphrase: string } | { key: Hex };

const NETS = (Object.keys(ETH_NETS) as EthNet[]).filter((n) => !ETH_NETS[n].real);

async function holdingsAt(address: string): Promise<Holding[]> {
  const jobs: Promise<Holding | null>[] = [];
  for (const net of NETS) {
    jobs.push(ethBalance(net, address).then((amount) => (amount > 0n ? { net, symbol: ETH_NETS[net].unit, decimals: 18, amount } : null)).catch(() => null));
    for (const t of KNOWN_TOKENS.filter((k) => k.chainId === ETH_NETS[net].chainId))
      jobs.push(tokenBalance(net, t, address).then((amount) => (amount > 0n ? { net, symbol: t.symbol, contract: t.contract, decimals: t.decimals, amount } : null)).catch(() => null));
  }
  return (await Promise.all(jobs)).filter((x): x is Holding => !!x);
}

/** The private keys this source can make, with where each came from. Callers must wipe them (`k.fill(0)`). */
function keysOf(src: Source): { style: FoundAddress['style']; index: number; sk: Uint8Array }[] {
  if ('key' in src) return [{ style: 'key', index: 0, sk: hexToBytes(src.key.slice(2)) }];
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(normalizeMnemonic(src.words), src.passphrase));
  return scanTargets().map((t) => {
    const k = root.derive(t.path);
    if (!k.privateKey) throw new Error('Key derivation failed');
    return { style: t.style, index: t.index, sk: k.privateKey };
  });
}

/** Look at every likely address and report the ones holding money, leaving out addresses this wallet already owns. */
export async function findMoney(src: Source, own: string[]): Promise<FoundAddress[]> {
  const keys = keysOf(src);
  try {
    const found = await Promise.all(
      keys.map(async (k) => {
        const address = privateKeyToAccount(`0x${bytesToHex(k.sk)}`).address;
        const label = k.style === 'key' ? 'key' : `${PATH_STYLES.find((s) => s.id === k.style)!.id} ${k.index + 1}`;
        return { from: label, style: k.style, address, holdings: await holdingsAt(address) } as FoundAddress;
      }),
    );
    return onlyWithMoney(found, own);
  } finally {
    keys.forEach((k) => k.sk.fill(0));
  }
}

/** Move everything found into `to(net)`. Returns the number of transactions sent, and any plain-language problems. */
export async function moveMoney(src: Source, found: FoundAddress[], to: (net: string) => string): Promise<{ sent: number; problems: string[] }> {
  const keys = keysOf(src);
  let sent = 0;
  const problems: string[] = [];
  try {
    for (const k of keys) {
      const sk = `0x${bytesToHex(k.sk)}` as Hex;
      const address = privateKeyToAccount(sk).address;
      const f = found.find((x) => x.address.toLowerCase() === address.toLowerCase());
      if (!f) continue;
      for (const net of new Set(f.holdings.map((h) => h.net))) {
        try {
          sent += (await sweepEvm(net as EthNet, sk, to(net))).length;
        } catch (e) {
          problems.push((e as Error).message);
        }
      }
    }
  } finally {
    keys.forEach((k) => k.sk.fill(0));
  }
  return { sent, problems };
}
