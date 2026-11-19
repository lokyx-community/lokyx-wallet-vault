import { isAddress } from './lokyx';
import { readToken, tokens } from './data';
import { ETH_NETS, KNOWN_TOKENS, ethAddressOk } from './multichain-core';
import { activeNets, addToken, lookupToken } from './multichain';
import { SOL_NETS } from './sol-core';
import { TRON_NETS } from './tron-core';
import { SOL_TOKENS, TRON_TOKENS, addWatchedX, lookupSolToken, lookupTronToken } from './xchains';
import type { TokenChain } from './add-token-core';

export interface Looked { chain: TokenChain; id: string; symbol: string; name: string; known: string | null; lookalike: string | null; save: () => Promise<void> }

/** The network the wallet is on for this chain, in words ("Solana · devnet"). */
export function netLabel(chain: TokenChain): string {
  const n = activeNets();
  if (chain === 'lyx') return 'LOKYX';
  if (chain === 'eth') return ETH_NETS[n.eth].label;
  return chain === 'sol' ? SOL_NETS[n.sol].label : TRON_NETS[n.trx].label;
}

/** Read a token from its network. Throws a plain message when the address is not a token there. */
export async function lookupFor(chain: TokenChain, text: string): Promise<Looked> {
  const a = text.trim();
  const n = activeNets();
  if (chain === 'lyx') {
    const id = a.toLowerCase();
    if (!isAddress(id)) throw new Error('That is not a LOKYX address.');
    const t = await readToken(id).catch((e: Error) => { throw new Error(e.message.includes('no contract') ? 'Nothing lives at that address.' : e.message); });
    return { chain, id, symbol: t.symbol, name: t.name, known: null, lookalike: null, save: () => tokens.save((x) => [...x.filter((y) => y.address !== t.address), t]) };
  }
  if (chain === 'eth') {
    if (!ethAddressOk(a)) throw new Error('That is not an Ethereum address.');
    const t = await lookupToken(n.eth, a);
    const k = KNOWN_TOKENS.find((x) => x.chainId === t.chainId && x.contract.toLowerCase() === a.toLowerCase());
    const copy = !k ? KNOWN_TOKENS.find((x) => x.chainId === t.chainId && x.symbol.toUpperCase() === t.symbol.toUpperCase()) : undefined;
    return { chain, id: a, symbol: t.symbol, name: k?.name ?? t.symbol, known: k ? k.name ?? k.symbol : null, lookalike: copy ? copy.name ?? copy.symbol : null, save: () => addToken(k ? { ...t, name: k.name } : t) };
  }
  if (chain === 'sol') {
    const t = await lookupSolToken(n.sol, a);
    const k = SOL_TOKENS[a];
    const copy = !k ? Object.values(SOL_TOKENS).find((x) => x.symbol.toUpperCase() === t.symbol.toUpperCase()) : undefined;
    return { chain, id: a, symbol: t.symbol, name: t.name, known: k ? k.name : null, lookalike: copy ? copy.name : null, save: () => addWatchedX(t) };
  }
  const t = await lookupTronToken(n.trx, a);
  const k = TRON_TOKENS[n.trx]?.[a];
  const copy = !k ? Object.values(TRON_TOKENS[n.trx] ?? {}).find((x) => x.symbol.toUpperCase() === t.symbol.toUpperCase()) : undefined;
  return { chain, id: a, symbol: t.symbol, name: t.name, known: k ? k.name : null, lookalike: copy ? copy.name : null, save: () => addWatchedX(t) };
}
