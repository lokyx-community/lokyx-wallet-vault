import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Aurora } from '../ui/Aurora';
import { T } from '../ui/Text';
import { MarkDraw } from '../ui/Intro';
import { PortfolioCard } from '../ui/PortfolioBits';
import { C, F } from '../ui/theme';
import { EASE_OUT } from '../ui/motion';
import { useAccountRef } from '../lib/wallet';

const EMPTY = { total: 0, change: 0, pct: 0, lines: [], series: [] };

/** After the setup questions: the mark draws while the wallet is made, then the first card rises, and Home opens. */
export default function Making() {
  const { vault } = useLocalSearchParams<{ vault?: string }>();
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const me = useAccountRef();
  const [name] = useState(me?.name);
  const a = useSharedValue(still ? 1 : 0);
  const b = useSharedValue(still ? 1 : 0);
  const cw = Math.round(Math.min(width - 32, 420) * 0.7);
  const ch = Math.round(cw * 1.28);

  useEffect(() => {
    const ms = still ? 400 : 4600;
    if (!still) {
      a.value = withTiming(1, { duration: 600, easing: EASE_OUT });
      b.value = withDelay(2300, withTiming(1, { duration: 1300, easing: Easing.out(Easing.cubic) }));
    }
    const h = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 3300);
    const t = setTimeout(() => {
      router.replace('/');
      if (vault === '1') setTimeout(() => router.push('/ethvault/setup'), 60);
    }, ms);
    return () => { clearTimeout(h); clearTimeout(t); };
  }, [still, a, b, vault]);

  const making = useAnimatedStyle(() => ({ opacity: interpolate(b.value, [0, 0.35], [a.value, 0], 'clamp') }));
  const card = useAnimatedStyle(() => ({ opacity: interpolate(b.value, [0, 0.4], [0, 1], 'clamp'), transform: [{ translateY: (1 - b.value) * 60 }, { scale: 0.94 + 0.06 * b.value }] }));
  const hello = useAnimatedStyle(() => ({ opacity: interpolate(b.value, [0.4, 1], [0, 1], 'clamp') }));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Aurora strength={1} />
      <Animated.View style={[{ position: 'absolute', alignItems: 'center', gap: 20 }, making]}>
        <MarkDraw size={64} delay={100} color="#fff" />
        <T v="callout" dim>Making your wallet</T>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', top: 130 }, hello]}>
        <T style={{ fontFamily: F.regular, fontSize: 16.5, color: C.sub }}>Welcome{name ? `, ${name}` : ''}</T>
      </Animated.View>
      <Animated.View style={card}>
        <PortfolioCard p={EMPTY} cur="usd" width={cw} height={ch} hide={false} />
      </Animated.View>
    </View>
  );
}
