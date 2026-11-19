import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

/** The tint each coin lays over its card, like the coloured edge of a pass in Wallet. */
export const COIN_TINT: Record<string, string> = { lyx: '#8A8A93', btc: '#F7931A', eth: '#627EEA', sol: '#9945FF', trx: '#EB0029' };

/** A rounded card in graphite with a soft glow of the coin's own colour in its top corner. */
export function PassCard({ tint = '#8A8A93', children, style }: { tint?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ borderRadius: 26, overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: '#161618' }, style]}>
      <Svg style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <LinearGradient id="base" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#242428" />
            <Stop offset="1" stopColor="#0F0F11" />
          </LinearGradient>
          <RadialGradient id="tint" cx="1" cy="0" rx="0.9" ry="0.8" fx="1" fy="0">
            <Stop offset="0" stopColor={tint} stopOpacity={0.3} />
            <Stop offset="1" stopColor={tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#base)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tint)" />
      </Svg>
      {children}
    </View>
  );
}
