import type { ChainSettings } from './multichain-core.ts';
import { SOL_NETS, type SolNet } from './sol-core.ts';
import { TRON_NETS, type TronNet } from './tron-core.ts';

/** The same last guard as for Bitcoin and Ethereum: no real money while that setting is off. */
export function assertAllowedX(s: ChainSettings, chain: 'sol' | 'trx', net: SolNet | TronNet) {
  const real = chain === 'sol' ? SOL_NETS[net as SolNet].real : TRON_NETS[net as TronNet].real;
  if (real && !s.allowMainnet) throw new Error('Real-money networks are turned off. This beta only sends on test networks.');
}
