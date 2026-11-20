import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Press } from './controls';
import { Logo } from './Logo';
import { TokenLogo } from './CoinLogo';
import { T } from './Text';
import { C, F } from './theme';
import { changeText, money, type Currency, type Line, type Portfolio } from '../lib/prices-core';

const up = (p: Portfolio) => p.change >= 0;

/** The last card in the Home deck: the total, today's change and the week. */
export function PortfolioCard({ p, cur, width, height, hide }: { p: Portfolio; cur: Currency; width: number; height: number; hide: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const narrow = width < 300;
  return (
    <View style={{ width, height, borderRadius: 34, backgroundColor: '#0B0B14', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 10 }}>
      {/* a quiet foil: violet, teal and bronze light on near-black, with a soft fall of white from the top left */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`v${id}`} cx="0.25" cy="0.2" rx="0.8" ry="0.7">
            <Stop offset="0" stopColor="#3B2A7A" stopOpacity="0.95" />
            <Stop offset="1" stopColor="#3B2A7A" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`t${id}`} cx="0.85" cy="0.35" rx="0.7" ry="0.6">
            <Stop offset="0" stopColor="#0E5A66" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#0E5A66" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`b${id}`} cx="0.6" cy="1" rx="0.8" ry="0.55">
            <Stop offset="0" stopColor="#6B3D1E" stopOpacity="0.85" />
            <Stop offset="1" stopColor="#6B3D1E" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id={`h${id}`} x1="0" y1="0" x2="0.55" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity="0.22" />
            <Stop offset="0.55" stopColor="#fff" stopOpacity="0.03" />
            <Stop offset="1" stopColor="#fff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#v${id})`} />
        <Rect width={width} height={height} fill={`url(#t${id})`} />
        <Rect width={width} height={height} fill={`url(#b${id})`} />
        <Rect width={width} height={height} fill={`url(#h${id})`} />
      </Svg>
      <View style={{ position: 'absolute', left: 22, top: 22 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 16, letterSpacing: -0.2, color: '#fff' }}>All coins</T>
        <T style={{ fontSize: 10, letterSpacing: 1.8, color: 'rgba(255,255,255,0.72)', marginTop: 1 }}>PORTFOLIO</T>
      </View>
      <View style={{ position: 'absolute', left: 22, right: 18, bottom: 22, gap: 2 }}>
        <T style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Total balance</T>
        <T numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: F.medium, fontSize: narrow ? 31 : 40, lineHeight: narrow ? 38 : 48, letterSpacing: narrow ? -1.3 : -1.8, color: '#fff' }}>{hide ? '••••' : money(p.total, cur)}</T>
        {!hide ? <T style={{ fontFamily: F.medium, fontSize: 12.5, color: up(p) ? '#7BF0B8' : '#FF9A9A' }}>{changeText(p.change, p.pct, cur)}</T> : null}
      </View>
    </View>
  );
}

/** The "Your coins" row under the buttons on Home. */
export function CoinsRow({ p, cur, hide, onPress }: { p: Portfolio; cur: Currency; hide: boolean; onPress: () => void }) {
  const shown = p.lines.slice(0, 4);
  return (
    <Press onPress={onPress} haptic={false} scaleTo={0.985} accessibilityLabel="Your coins" style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' }}>
      <View style={{ flexDirection: 'row' }}>
        {shown.map((l, i) => (
          <View key={l.symbol} style={{ marginLeft: i ? -9 : 0 }}>
            <LineLogo l={l} size={30} />
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.medium, fontSize: 15 }}>Your coins</T>
        <T v="caption" dim>{p.lines.length === 1 ? '1 coin' : `${p.lines.length} coins`}</T>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T style={{ fontFamily: F.semibold, fontSize: 16, fontVariant: ['tabular-nums'] }}>{hide ? '••••' : money(p.total, cur)}</T>
        {!hide ? <T style={{ fontFamily: F.medium, fontSize: 12.5, color: up(p) ? C.good : C.bad }}>{`${up(p) ? '▲' : '▼'} ${Math.abs(p.pct).toFixed(1)}%`}</T> : null}
      </View>
    </Press>
  );
}

export function LineLogo({ l, size }: { l: Line; size: number }) {
  return l.logo ? <Logo id={l.logo} size={size} /> : <TokenLogo symbol={l.symbol} seed={l.id} size={size} />;
}
