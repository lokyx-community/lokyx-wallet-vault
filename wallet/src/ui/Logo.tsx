import { useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { LOGOS, type LogoId } from './logos';

const lum = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  const y = Math.round(0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255));
  return `#${y.toString(16).padStart(2, '0').repeat(3)}`;
};

/** A real coin or network mark. `grey` turns it black-and-white: coins you haven't added look like this, and take their colour when you do. */
export function Logo({ id, size, grey }: { id: LogoId; size: number; grey?: boolean }) {
  const xml = useMemo(() => (grey ? LOGOS[id].replace(/#[0-9A-Fa-f]{6}/g, (m) => lum(m)) : LOGOS[id]), [id, grey]);
  return <SvgXml xml={xml} width={size} height={size} opacity={grey ? 0.7 : 1} />;
}

const BY_SYMBOL: Record<string, LogoId> = { USDT: 'usdt', USDC: 'usdc', BTC: 'btc', ETH: 'eth', SOL: 'sol', TRX: 'trx', DOGE: 'doge', LTC: 'ltc', BNB: 'bnb', POL: 'pol', MATIC: 'pol' };
export const logoFor = (symbol: string): LogoId | null => BY_SYMBOL[symbol.toUpperCase()] ?? null;
