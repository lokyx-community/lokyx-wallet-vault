import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

/** The Bitcoin mark (the one the LOKYX app already uses). */
export function BtcLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={16} fill="#F7931A" />
      <G rotation={14} origin="16,16" fill="#fff">
        <Path d="M11 8.5h6.2c2.6 0 4.1 1.3 4.1 3.3 0 1.4-.8 2.4-2 2.8 1.6.3 2.7 1.5 2.7 3.2 0 2.4-1.8 3.7-4.6 3.7H11zm3 2.4v3.1h2.7c1.1 0 1.8-.6 1.8-1.6s-.7-1.5-1.8-1.5zm0 5.4v3.3h3c1.2 0 2-.6 2-1.7 0-1-.8-1.6-2-1.6z" />
        <Rect x={13} y={6.3} width={1.8} height={2.6} rx={0.4} />
        <Rect x={16} y={6.3} width={1.8} height={2.6} rx={0.4} />
        <Rect x={13} y={21.2} width={1.8} height={2.6} rx={0.4} />
        <Rect x={16} y={21.2} width={1.8} height={2.6} rx={0.4} />
      </G>
    </Svg>
  );
}

/** The Ethereum diamond on its blue coin, drawn here from the standard shape (not an official asset file). */
export function EthLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={16} fill="#627EEA" />
      <G fill="#fff">
        <Path d="M16.498 4v8.87l7.497 3.35z" fillOpacity={0.602} />
        <Path d="M16.498 4L9 16.22l7.498-3.35z" />
        <Path d="M16.498 21.968v6.027L24 17.616z" fillOpacity={0.602} />
        <Path d="M16.498 27.995v-6.028L9 17.616z" />
        <Path d="M16.498 20.573l7.497-4.353-7.497-3.348z" fillOpacity={0.2} />
        <Path d="M9 16.22l7.498 4.353v-7.701z" fillOpacity={0.602} />
      </G>
    </Svg>
  );
}

/** The LOKYX mark (the open ring with its dot, as in assets/lokyx-256.png), black on a white coin. */
export function LyxLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={16} fill="#F2F2F2" />
      <Path d="M16.74 7.53 A8.5 8.5 0 1 0 24.47 16.74" stroke="#000" strokeWidth={3} strokeLinecap="round" fill="none" />
      <Circle cx={22.5} cy={10.5} r={1.7} fill="#000" />
    </Svg>
  );
}

/** A token with no logo of its own: its first letters on a quiet coin, coloured from its address. */
export function TokenLogo({ symbol, seed, size }: { symbol: string; seed: string; size: number }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={16} fill={`hsl(${hue}, 45%, 28%)`} />
      <Circle cx={16} cy={16} r={15.25} stroke={`hsl(${hue}, 60%, 55%)`} strokeOpacity={0.5} strokeWidth={1.5} fill="none" />
      <SvgText x={16} y={20.2} fontSize={symbol.length > 3 ? 8.5 : 11} fontWeight="700" fill="#fff" textAnchor="middle">
        {symbol.slice(0, 4).toUpperCase()}
      </SvgText>
    </Svg>
  );
}

export const CoinLogo = ({ chain, size }: { chain: 'btc' | 'eth' | 'lyx'; size: number }) =>
  chain === 'btc' ? <BtcLogo size={size} /> : chain === 'eth' ? <EthLogo size={size} /> : <LyxLogo size={size} />;
