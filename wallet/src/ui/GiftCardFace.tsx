import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Logo } from './Logo';
import { Digits } from './Digits';
import { Skeleton } from './Skeleton';
import { LyxBadge } from './WalletCards';
import { F } from './theme';
import type { GiftCoin } from '../lib/gift-core';

/** One quiet tone per coin: a lit corner, a body, a deep edge. LOKYX stays graphite. */
const TONE: Record<GiftCoin, { lit: string; mid: string; deep: string; glow: string; shadow: string }> = {
  lyx: { lit: '#5C5F69', mid: '#26282F', deep: '#0B0C10', glow: 'rgba(160,165,185,0.22)', shadow: '#A0A5B9' },
  btc: { lit: '#8A5A2E', mid: '#4A2E16', deep: '#150C06', glow: 'rgba(214,150,80,0.24)', shadow: '#D69650' },
  eth: { lit: '#4E5690', mid: '#252A55', deep: '#0A0C22', glow: 'rgba(110,125,225,0.26)', shadow: '#6E7DE1' },
};
const NAME: Record<GiftCoin, string> = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum' };

/**
 * A gift card: a calm surface in the coin's own tone, fine engraved circles, a thin bright edge, the coin's real logo,
 * and a soft light that passes over it now and then.
 */
export function GiftCardFace({ coin, width, to, note, balance, unit, tag }: { coin: GiftCoin; width: number; to?: string; note?: string; balance: string; unit: string; tag?: string }) {
  const height = Math.round(width / 1.6);
  const t = TONE[coin];
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const still = useReducedMotion();
  const sweep = useSharedValue(-1);
  useEffect(() => {
    if (still) return;
    sweep.value = withRepeat(withSequence(withDelay(2600, withTiming(1.4, { duration: 1500, easing: Easing.inOut(Easing.quad) })), withTiming(-1, { duration: 0 })), -1);
  }, [still, sweep]);
  const shine = useAnimatedStyle(() => ({ transform: [{ translateX: sweep.value * width }, { skewX: '-18deg' }] }));
  const R = height * 0.62;
  const rings = Array.from({ length: 12 }, (_, i) => R * (0.25 + i * 0.07));
  return (
    <View style={{ width, height, borderRadius: 24, overflow: 'hidden', shadowColor: t.shadow, shadowOpacity: 0.35, shadowRadius: 26, shadowOffset: { width: 0, height: 16 }, elevation: 10 }}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.lit} />
            <Stop offset="0.5" stopColor={t.mid} />
            <Stop offset="1" stopColor={t.deep} />
          </LinearGradient>
          <RadialGradient id={`g${id}`} cx="0%" cy="100%" r="70%">
            <Stop offset="0" stopColor={t.glow} />
            <Stop offset="1" stopColor={t.glow} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id={`e${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity={0.42} />
            <Stop offset="0.45" stopColor="#fff" stopOpacity={0.04} />
            <Stop offset="1" stopColor="#fff" stopOpacity={0.26} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#b${id})`} />
        <Rect width={width} height={height} fill={`url(#g${id})`} />
        {rings.map((r, i) => (
          <Circle key={i} cx={width * 0.86} cy={height * 0.14} r={r} stroke="#fff" strokeOpacity={0.07} strokeWidth={1} fill="none" />
        ))}
        <Rect x={0.6} y={0.6} width={width - 1.2} height={height - 1.2} rx={23.4} stroke={`url(#e${id})`} strokeWidth={1.2} fill="none" />
      </Svg>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -10, bottom: -10, left: 0, width: width * 0.22, backgroundColor: 'rgba(255,255,255,0.1)' }, shine]} />
      <View style={{ position: 'absolute', left: 22, top: 20 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 11, letterSpacing: 2.2, color: 'rgba(255,255,255,0.72)' }}>GIFT CARD</T>
        <T style={{ fontFamily: F.medium, fontSize: 15, color: '#fff', paddingTop: 4 }}>{to || `${NAME[coin]} gift`}</T>
      </View>
      <View style={{ position: 'absolute', right: 20, top: 18, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
        {coin === 'lyx' ? <LyxBadge size={44} /> : <Logo id={coin} size={44} />}
        <View style={{ position: 'absolute', left: -5, top: -5, right: -5, bottom: -5, borderRadius: 27, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }} />
      </View>
      <View style={{ position: 'absolute', left: 22, bottom: note || tag ? 40 : 26, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        {/^[\d,.]+$/.test(balance || '') ? (
          <Digits text={balance} intro style={{ fontFamily: F.semibold, fontSize: 40, lineHeight: 46, letterSpacing: -1.6 }} color="#fff" />
        ) : !balance ? (
          <View style={{ height: 46, justifyContent: 'center' }}><Skeleton w={140} h={28} r={10} /></View>
        ) : (
          <T style={{ fontFamily: F.semibold, fontSize: 40, lineHeight: 46, letterSpacing: -1.6, color: '#fff' }}>{balance}</T>
        )}
        <T style={{ fontFamily: F.semibold, fontSize: 16, color: 'rgba(255,255,255,0.8)', paddingBottom: 9 }}>{unit}</T>
      </View>
      {note || tag ? (
        <View style={{ position: 'absolute', left: 22, right: 22, bottom: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontFamily: F.regular, fontSize: 13, color: 'rgba(255,255,255,0.72)', flexShrink: 1 }} numberOfLines={1}>{note ?? ''}</T>
          {tag ? <T style={{ fontFamily: F.semibold, fontSize: 10, letterSpacing: 1.4, color: 'rgba(255,255,255,0.72)' }}>{tag.toUpperCase()}</T> : null}
        </View>
      ) : null}
    </View>
  );
}
