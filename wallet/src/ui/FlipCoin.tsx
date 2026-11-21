import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Icon } from './Icon';
import { C, F } from './theme';

/** A coin that turns edge-on and back whenever its short name changes, so typing feels like minting. */
export function FlipCoin({ sym, face, edge, ink, size = 112 }: { sym: string; face: string; edge: string; ink: string; size?: number }) {
  const still = useReducedMotion();
  const x = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (still) return;
    x.value = withSequence(withTiming(0.04, { duration: 160, easing: Easing.in(Easing.quad) }), withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
  }, [sym, still, x]);
  const turn = useAnimatedStyle(() => ({ transform: [{ scaleX: x.value }] }));
  const inner = size - 16;
  return (
    <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: edge, alignItems: 'center', justifyContent: 'center', shadowColor: edge, shadowOpacity: 0.4, shadowRadius: 26, shadowOffset: { width: 0, height: 8 } }, turn]}>
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: face, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}>
        {sym ? <T style={{ fontFamily: F.semibold, fontSize: sym.length > 4 ? 20 : 28, color: ink, letterSpacing: -0.8 }}>{sym}</T> : <Icon name="plus" size={34} color={ink} />}
      </View>
    </Animated.View>
  );
}
