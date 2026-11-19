import { View } from 'react-native';
import { Logo, logoFor } from './Logo';
import { TokenLogo } from './CoinLogo';
import { ETH_NETS, EVM_FAMILIES, evmOf, type EthNet } from '../lib/multichain-core';
import type { LogoId } from './logos';

/** A network's mark: its real logo when the app has one, otherwise its first letters on a quiet coin. */
export function NetMark({ net, size }: { net: EthNet; size: number }) {
  const f = evmOf(net);
  if (f) return <Logo id={EVM_FAMILIES[f].logo} size={size} />;
  if (net === 'mainnet' || net === 'sepolia') return <Logo id="eth" size={size} />;
  return <TokenLogo symbol={ETH_NETS[net].short.slice(0, 2)} seed={net} size={size} />;
}

export const netLogoId = (net: EthNet): LogoId | null => {
  const f = evmOf(net);
  return f ? EVM_FAMILIES[f].logo : net === 'mainnet' || net === 'sepolia' ? 'eth' : null;
};

/** A coin's round logo, with a small badge for the network it is on. */
export function CoinMark({ symbol, seed, size = 40, logo, net }: { symbol: string; seed: string; size?: number; logo?: LogoId | null; net?: EthNet }) {
  const id = logo ?? logoFor(symbol);
  const b = Math.round(size * 0.4);
  return (
    <View style={{ width: size, height: size }}>
      {id ? <Logo id={id} size={size} /> : <TokenLogo symbol={symbol} seed={seed} size={size} />}
      {net ? (
        <View style={{ position: 'absolute', right: -4, bottom: -4, borderRadius: 99, backgroundColor: '#000', padding: 2 }}>
          <NetMark net={net} size={b} />
        </View>
      ) : null}
    </View>
  );
}
