import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { T } from './Text';
import { Icon } from './Icon';
import { Avatar } from './RingCode';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';
import { shortAddr, type Assessment } from '../lib/signing-core';

/** A calm rose for "stopped". The app avoids loud red; this stays quiet and still reads as a no. */
export const ROSE = '#D98880';

const TONE = {
  stop: { color: ROSE, label: 'STOPPED', icon: 'shield' as const },
  review: { color: C.wait, label: 'TAKE A LOOK', icon: 'eye' as const },
  allow: { color: C.good, label: 'LOOKS FINE', icon: 'shield' as const },
};

/** The result of the signing check: a seal, what was asked, who gets it, and one line on why. */
export function SignVerdict({ a, me }: { a: Assessment; me: string }) {
  const tone = TONE[a.level];
  const ring = useSharedValue(0);
  useEffect(() => {
    ring.value = withDelay(80, withTiming(1, { duration: DUR.slow, easing: EASE_OUT }));
    if (a.level === 'stop') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    else if (a.level === 'allow') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [a.level, ring]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value, transform: [{ scale: 0.86 + 0.14 * ring.value }] }));
  const to = a.main?.spender;

  return (
    <View style={{ gap: 18 }}>
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 4 }}>
        <Animated.View style={[{ width: 68, height: 68, borderRadius: 34, borderWidth: 1, borderColor: tone.color + '55', backgroundColor: tone.color + '14', alignItems: 'center', justifyContent: 'center' }, ringStyle]}>
          <Icon name={tone.icon} size={30} color={tone.color} />
        </Animated.View>
        <T style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 2.4, color: tone.color }}>{tone.label}</T>
      </View>
      <Animated.View entering={FadeInDown.duration(DUR.base).easing(EASE_OUT)} style={{ gap: 6 }}>
        <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.7, lineHeight: 32, textAlign: 'center' }}>{a.headline}</T>
        {a.sub ? <T v="sub" dim style={{ textAlign: 'center' }}>{a.sub}</T> : null}
      </Animated.View>

      {to ? (
        <Animated.View entering={FadeIn.delay(160).duration(DUR.base)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 }}>
          <View style={{ alignItems: 'center', gap: 6, width: 72 }}>
            {me ? <Avatar address={me} size={40} /> : <View style={{ width: 40, height: 40 }} />}
            <T v="caption" dim>You</T>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: a.level === 'stop' ? tone.color + '88' : C.line2 }} />
            {a.level === 'stop' ? <View style={{ width: 3, height: 26, borderRadius: 2, backgroundColor: tone.color, marginHorizontal: 6 }} /> : <Icon name="forward" size={16} color={C.sub} />}
            <View style={{ flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: C.line2 }} />
          </View>
          <View style={{ alignItems: 'center', gap: 6, width: 72 }}>
            <Avatar address={to} size={40} />
            <T v="caption" dim>{shortAddr(to)}</T>
          </View>
        </Animated.View>
      ) : null}

      {a.main ? (
        <Animated.View entering={FadeIn.delay(240).duration(DUR.base)} style={{ borderRadius: 20, backgroundColor: C.fill }}>
          {([['Coin', a.token], ['Amount', a.amountText], ['Lasts', a.endsText]] as [string, string][]).filter(([, v]) => v).map(([l, v], i) => (
            <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderColor: C.line }}>
              <T v="sub" dim style={{ fontSize: 15 }}>{l}</T>
              <T v="callout" color={l === 'Amount' && a.level === 'stop' ? tone.color : C.text}>{v}</T>
            </View>
          ))}
        </Animated.View>
      ) : null}

      {a.why ? <T v="sub" dim style={{ textAlign: 'center' }}>{a.why}</T> : null}
    </View>
  );
}
