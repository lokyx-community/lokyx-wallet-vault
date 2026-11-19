import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button } from '../ui/controls';
import { MarkDraw } from '../ui/Intro';
import { RingCode } from '../ui/RingCode';
import { C } from '../ui/theme';
import { DUR, EASE_OUT } from '../ui/motion';

const SAMPLE = 'lyx1pvc9275lcn5suv6c0k3v0mq3xedcpfw28j3pj0';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 90_000, easing: Easing.linear }), -1);
  }, [spin]);
  const back = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: 0.07 }]}>
        <Animated.View style={back}>
          <RingCode address={SAMPLE} size={620} center={false} />
        </Animated.View>
      </Animated.View>

      <View style={{ flex: 1, justifyContent: 'center', gap: 36 }}>
        <MarkDraw size={84} />
        <Animated.View entering={FadeInDown.delay(900).duration(DUR.base).easing(EASE_OUT)} style={{ gap: 14 }}>
          <T style={{ fontFamily: 'Geist_600SemiBold', fontSize: 44, lineHeight: 54, letterSpacing: -1.8 }}>Your money.{'\n'}Your keys.</T>
          <T v="body" dim style={{ fontSize: 17, lineHeight: 25, maxWidth: 320 }}>
            A wallet for LOKYX. No sign-up, no email. Your keys are made on this phone and stay on it.
          </T>
        </Animated.View>
      </View>

      <Animated.View entering={FadeInDown.delay(1100).duration(DUR.base).easing(EASE_OUT)} style={{ gap: 10 }}>
        <Button title="Create a wallet" onPress={() => router.push('/create')} />
        <Button title="I already have one" kind="plain" onPress={() => router.push('/restore')} />
      </Animated.View>
    </View>
  );
}
