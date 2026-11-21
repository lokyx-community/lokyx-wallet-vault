import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { F } from './theme';
import { EASE_OUT } from './motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The chance of Yes as a ring that fills to its value when it appears and glides when the odds move. */
export function OddsRing({ pct, size = 84, color = '#6FD6A3' }: { pct: number | null; size?: number; color?: string }) {
  const still = useReducedMotion();
  const v = useSharedValue(0);
  const stroke = 7;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  useEffect(() => {
    const to = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
    v.value = still ? to : withTiming(to, { duration: 900, easing: EASE_OUT });
  }, [pct, still, v]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - v.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel={pct === null ? 'Chance of Yes unknown' : `${Math.round(pct)} percent chance of Yes`}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={`${len} ${len}`} animatedProps={props} />
      </Svg>
      <T style={{ fontFamily: F.semibold, fontSize: 20, letterSpacing: -0.5 }}>{pct === null ? '—' : `${Math.round(pct)}%`}</T>
    </View>
  );
}
