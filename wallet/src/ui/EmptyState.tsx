import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from './Icon';
import { T } from './Text';
import { Button } from './controls';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

/** One star that comes and goes on its own beat. */
function Twinkle({ x, y, delay }: { x: number; y: number; delay: number }) {
  const o = useSharedValue(0);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    o.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1700, easing: Easing.inOut(Easing.quad) })), -1));
  }, [delay, o, still]);
  const s = useAnimatedStyle(() => ({ opacity: o.value * 0.9, transform: [{ scale: 0.4 + o.value * 0.9 }] }));
  return <Animated.View style={[{ position: 'absolute', left: x, top: y, width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' }, s]} />;
}

/**
 * An empty screen that says what goes here and what to do. A slow dashed ring turns around the mark, which floats a little,
 * a soft glow breathes behind it, stars come and go, and the button gives a gentle pulse. Calm, never a red box.
 */
export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: { label: string; onPress: () => void } }) {
  const still = useReducedMotion();
  const spin = useSharedValue(0);
  const float = useSharedValue(0);
  const glow = useSharedValue(0.4);
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    spin.value = withRepeat(withTiming(360, { duration: 40000, easing: Easing.linear }), -1);
    float.value = withRepeat(withSequence(withTiming(-7, { duration: 2500, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 2500, easing: Easing.inOut(Easing.quad) })), -1);
    glow.value = withRepeat(withSequence(withTiming(0.8, { duration: 1700 }), withTiming(0.4, { duration: 1700 })), -1);
    pulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1);
  }, [still, spin, float, glow, pulse]);
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const mark = useAnimatedStyle(() => ({ transform: [{ translateY: float.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value }));
  const beat = useAnimatedStyle(() => ({ opacity: (1 - pulse.value) * 0.5, transform: [{ scale: 1 + pulse.value * 0.12 }] }));
  return (
    <Animated.View entering={FadeIn.duration(DUR.slow).easing(EASE_OUT)} style={{ alignItems: 'center', gap: 10, paddingVertical: 40, paddingHorizontal: 28 }}>
      <View style={{ width: 190, height: 160, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Twinkle x={20} y={28} delay={0} />
        <Twinkle x={158} y={44} delay={700} />
        <Twinkle x={30} y={118} delay={1400} />
        <Twinkle x={150} y={124} delay={2000} />
        <Animated.View style={[{ position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.12)' }, halo]} />
        <Animated.View style={[{ position: 'absolute', width: 140, height: 140, borderRadius: 70, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)', borderStyle: 'dashed' }, ring]} />
        <Animated.View style={[{ width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 0.6, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }, mark]}>
          <Icon name={icon} size={30} color={C.text} width={1.7} />
        </Animated.View>
      </View>
      <T style={{ fontFamily: F.semibold, fontSize: 20, letterSpacing: -0.4, textAlign: 'center' }}>{title}</T>
      <T v="sub" style={{ textAlign: 'center', lineHeight: 21, color: C.soft }}>{body}</T>
      {action ? (
        <View style={{ alignSelf: 'stretch', paddingTop: 14 }}>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 14, bottom: 0, borderRadius: 30, backgroundColor: '#fff' }, beat]} />
          <Button title={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </Animated.View>
  );
}
