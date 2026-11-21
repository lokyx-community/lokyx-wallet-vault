import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { takeLift, type Rect } from '../lib/lift';

/** Put `ref` on the card's wrapper: it starts exactly where the Home card was and settles into its place. */
export function useLift() {
  const ref = useRef<View>(null);
  const from = useRef<Rect | null | undefined>(undefined);
  const p = useSharedValue(1);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const sc = useSharedValue(1);
  const still = useReducedMotion();
  if (from.current === undefined) from.current = takeLift();
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value * (1 - p.value) }, { translateY: dy.value * (1 - p.value) }, { scale: sc.value + (1 - sc.value) * p.value }],
  }));
  const onLayout = () => {
    const f = from.current;
    if (!f || still) return;
    ref.current?.measureInWindow((x, y, w, h) => {
      if (!w || !h || !from.current) return;
      from.current = null;
      dx.value = f.x + f.w / 2 - (x + w / 2);
      dy.value = f.y + f.h / 2 - (y + h / 2);
      sc.value = f.w / w;
      p.value = 0;
      p.value = withTiming(1, { duration: 560, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    });
  };
  useEffect(() => () => { from.current = null; }, []);
  return { ref, style, onLayout, lifted: !!from.current };
}
