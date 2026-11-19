import { useEffect } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { EASE_OUT } from './motion';
import { C } from './theme';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);
const ARC = 2 * Math.PI * 34 * 0.75;

/** The mark drawing itself: the ring sweeps round, then the dot drops into the gap. */
export function MarkDraw({ size = 96, delay = 150, color = C.text }: { size?: number; delay?: number; color?: string }) {
  const t = useSharedValue(0);
  const d = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 900, easing: Easing.bezier(0.65, 0, 0.35, 1) }));
    d.value = withDelay(delay + 760, withTiming(1, { duration: 420, easing: EASE_OUT }));
  }, [t, d, delay]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: ARC * (1 - t.value) }));
  const dot = useAnimatedProps(() => ({ r: 7.5 * d.value }));
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <APath d="M50 16A34 34 0 1 0 84 50" stroke={color} strokeWidth={14} strokeLinecap="round" strokeDasharray={`${ARC} ${ARC}`} animatedProps={arc} />
      <ACircle cx={74} cy={26} fill={color} animatedProps={dot} />
    </Svg>
  );
}
