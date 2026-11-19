import { useEffect, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient as LG, Rect, Stop } from 'react-native-svg';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { T } from './Text';
import { F } from './theme';
import { DUR, EASE_OUT } from './motion';
import { shortAddr } from '../lib/format';

const H = 188;

/**
 * The Apps wallet card: black satin with a small gold chip. The chip carries the LOKYX mark as a brand sign only
 * (the wallet is for every chain, so the card never shows a single total). `play` rises the card in once, then a
 * soft sheen crosses it.
 */
export function AppsCard({ address, play = false }: { address?: string | null; play?: boolean }) {
  const gid = 'a' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const [w, setW] = useState(0);
  const still = useReducedMotion();
  const rise = useSharedValue(play && !still ? 0 : 1);
  const chip = useSharedValue(play && !still ? 0 : 1);
  const sheen = useSharedValue(play && !still ? -1 : 2);
  useEffect(() => {
    if (!play || still) return;
    rise.value = withTiming(1, { duration: DUR.slow, easing: EASE_OUT });
    chip.value = withDelay(260, withTiming(1, { duration: DUR.base, easing: EASE_OUT }));
    sheen.value = withDelay(520, withTiming(1.4, { duration: 900, easing: EASE_OUT }));
    const t = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 700);
    return () => clearTimeout(t);
  }, [play, still, rise, chip, sheen]);
  const card = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: (1 - rise.value) * 28 }, { scale: 0.97 + 0.03 * rise.value }] }));
  const chipStyle = useAnimatedStyle(() => ({ opacity: chip.value, transform: [{ scale: 0.9 + 0.1 * chip.value }] }));
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sheen.value * 260 - 120 }, { rotate: '18deg' }] }));

  return (
    <Animated.View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} style={[{ height: H, borderRadius: 26, overflow: 'hidden', backgroundColor: '#0B0B0C', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' }, card]}>
      {w > 0 ? (
        <Svg style={StyleSheet.absoluteFill} width={w} height={H}>
          <Defs>
            <LG id={gid} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#2A2A2D" />
              <Stop offset="0.5" stopColor="#0B0B0C" />
              <Stop offset="1" stopColor="#1A1A1D" />
            </LG>
          </Defs>
          <Rect x={0} y={0} width={w} height={H} fill={`url(#${gid})`} />
        </Svg>
      ) : null}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -40, width: 70, height: H + 80, backgroundColor: 'rgba(255,255,255,0.07)' }, sheenStyle]} />
      <View style={{ flex: 1, padding: 20, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Animated.View style={[{ width: 50, height: 36, borderRadius: 9, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, chipStyle]}>
            <Svg style={StyleSheet.absoluteFill} width={50} height={36}>
              <Defs>
                <LG id={gid + 'g'} x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor="#F1E2C4" />
                  <Stop offset="0.55" stopColor="#CDB07F" />
                  <Stop offset="1" stopColor="#76603C" />
                </LG>
              </Defs>
              <Rect x={0} y={0} width={50} height={36} fill={`url(#${gid}g)`} />
            </Svg>
            <T style={{ fontFamily: F.semibold, fontSize: 8, letterSpacing: 1.4, color: '#2A2112' }}>LOKYX</T>
          </Animated.View>
          <T numberOfLines={1} style={{ flexShrink: 1, marginLeft: 12, fontFamily: F.semibold, fontSize: 11, letterSpacing: 1.6, color: 'rgba(255,255,255,0.55)' }}>APPS WALLET</T>
        </View>
        <View style={{ gap: 4 }}>
          <T style={{ fontFamily: F.medium, fontSize: 19, letterSpacing: -0.3 }}>For websites</T>
          <T v="caption" dim numberOfLines={1}>{address ? `${shortAddr(address, 8, 6)} · your vault stays hidden` : 'Your vault stays hidden'}</T>
        </View>
      </View>
    </Animated.View>
  );
}
