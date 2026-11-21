import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Press } from './controls';
import { Logo } from './Logo';
import { CoinLogo, TokenLogo } from './CoinLogo';
import { T } from './Text';
import { C, F } from './theme';
import { changeText, money, type Currency, type Line, type Portfolio } from '../lib/prices-core';

const up = (p: Portfolio) => p.change >= 0;

/** The last card in the Home deck: the total, today's change and the week. */
export function PortfolioCard({ p, cur, width, height, hide }: { p: Portfolio; cur: Currency; width: number; height: number; hide: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const narrow = width < 300;
  return (
    <View style={{ width, height, borderRadius: 34, backgroundColor: 'rgba(22,22,28,0.6)', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 8 }}>
      {/* frosted glass: a soft fall of white from the top left, a hairline light edge */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`h${id}`} x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity="0.2" />
            <Stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
            <Stop offset="1" stopColor="#fff" stopOpacity="0.08" />
          </LinearGradient>
          <RadialGradient id={`r${id}`} cx="0.9" cy="0.15" rx="0.7" ry="0.6">
            <Stop offset="0" stopColor="#fff" stopOpacity="0.14" />
            <Stop offset="1" stopColor="#fff" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#h${id})`} />
        <Rect width={width} height={height} fill={`url(#r${id})`} />
        <Rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={33.5} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
      </Svg>
      <View style={{ position: 'absolute', left: 22, top: 22 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 16, letterSpacing: -0.2, color: '#fff' }}>All coins</T>
        <T style={{ fontSize: 10, letterSpacing: 1.8, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>PORTFOLIO</T>
      </View>
      <View style={{ position: 'absolute', left: 22, right: 18, bottom: 22, gap: 2 }}>
        <T style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>Total balance</T>
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

const trimAmt = (n: number) => (n >= 1000 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(4)).replace(/\.?0+$/, '');

/** The Assets panel under the buttons on Home: each coin with its amount, its value and today's change. */
export function AssetsPanel({ p, cur, hide, onSeeAll, onCoin, lyx, onLyx }: { p: Portfolio; cur: Currency; hide: boolean; onSeeAll: () => void; onCoin?: (l: Line) => void; lyx?: string; onLyx?: () => void }) {
  const lines = [...p.lines].sort((a, b) => b.value - a.value).slice(0, 5);
  const hasLyx = !!lyx && amountOfStr(lyx) > 0;
  if (!lines.length && !hasLyx) return null;
  return (
    <View style={{ marginTop: 20, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 20, letterSpacing: -0.3 }}>Assets</T>
        <Press onPress={onSeeAll} haptic={false} accessibilityLabel="See all coins" hitSlop={10}>
          <T style={{ fontFamily: F.medium, fontSize: 14, color: C.sub }}>See all</T>
        </Press>
      </View>
      {lines.map((l, i) => {
        const gain = l.pct >= 0;
        return (
          <Press key={l.id + l.symbol} onPress={() => onCoin?.(l)} disabled={!onCoin} haptic={false} scaleTo={0.985} accessibilityLabel={l.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 62, borderTopWidth: i ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
            <LineLogo l={l} size={40} />
            <View style={{ flex: 1, gap: 1 }}>
              <T style={{ fontFamily: F.medium, fontSize: 16.5 }} numberOfLines={1}>{l.name}</T>
              <T v="caption" dim>{hide ? '•••' : `${trimAmt(l.amount)} ${l.symbol}`}</T>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 1 }}>
              <T style={{ fontFamily: F.medium, fontSize: 16.5, fontVariant: ['tabular-nums'] }}>{hide ? '••••' : money(l.value, cur)}</T>
              {!hide ? <T style={{ fontFamily: F.medium, fontSize: 12.5, color: gain ? C.good : C.bad }}>{`${gain ? '+' : '−'}${Math.abs(l.pct).toFixed(1)}%`}</T> : null}
            </View>
          </Press>
        );
      })}
      {hasLyx ? (
        <Press onPress={onLyx} disabled={!onLyx} haptic={false} scaleTo={0.985} accessibilityLabel="LOKYX" style={{ flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 62, borderTopWidth: lines.length ? 0.5 : 0, borderTopColor: 'rgba(255,255,255,0.08)' }}>
          <CoinLogo chain="lyx" size={40} />
          <View style={{ flex: 1, gap: 1 }}>
            <T style={{ fontFamily: F.medium, fontSize: 16.5 }}>LOKYX</T>
            <T v="caption" dim>{hide ? '•••' : `${lyx} LYX`}</T>
          </View>
          <T style={{ fontFamily: F.medium, fontSize: 12.5, color: C.faint }}>Test coin</T>
        </Press>
      ) : null}
    </View>
  );
}

const amountOfStr = (s: string) => Number(s.replace(/,/g, '')) || 0;
