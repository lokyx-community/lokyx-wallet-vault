import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { T } from './Text';
import { F } from './theme';

/** The LOKYX sign, in white. It settles in with one soft pulse of light when a payment is done. */
export function DoneMark({ label = 'Done' }: { label?: string }) {
  const still = useReducedMotion();
  const pop = useSharedValue(still ? 1 : 0.6);
  const glow = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    pop.value = withSpring(1, { damping: 11, stiffness: 140 });
    glow.value = withDelay(120, withSequence(withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.quad) })));
  }, [still, pop, glow]);
  const body = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: Math.min(1, pop.value * 1.4) }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value * 0.55, transform: [{ scale: 0.8 + glow.value * 0.7 }] }));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', height: 40, alignSelf: 'center' }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(130,160,255,0.45)' }, halo]} />
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingLeft: 10, paddingRight: 16, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.28)' }, body]}>
        <Svg width={22} height={22} viewBox="0 0 32 32">
          <Path d="M16.74 7.53 A8.5 8.5 0 1 0 24.47 16.74" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" fill="none" />
          <Circle cx={22.5} cy={10.5} r={1.8} fill="#fff" />
        </Svg>
        <T style={{ fontFamily: F.medium, fontSize: 14, color: '#fff' }}>{label}</T>
      </Animated.View>
    </View>
  );
}
