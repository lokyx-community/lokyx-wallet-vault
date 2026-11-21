import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { NeonCard, cardHeight, type NeonData } from './NeonCard';
import { takeLift, type Rect } from '../lib/lift';

const R = 34;

/**
 * The coin page's card. When it was opened from a Home card, it starts as that tall card, exactly where it sat,
 * and shrinks to its wide shape at the top. The tall card fades out and the wide one fades in on the way.
 */
export function LiftCard({ c, width, hide }: { c: NeonData; width: number; hide?: boolean }) {
  const h = cardHeight(width);
  const ref = useRef<View>(null);
  const from = useRef<Rect | null | undefined>(undefined);
  if (from.current === undefined) from.current = takeLift();
  const f0 = from.current;
  const still = useReducedMotion();
  const p = useSharedValue(f0 && !still ? 0 : 1);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const started = useRef(false);

  const onLayout = () => {
    if (!f0 || still || started.current) return;
    started.current = true;
    ref.current?.measureInWindow((x, y) => {
      dx.value = f0.x - x;
      dy.value = f0.y - y;
      p.value = 0;
      p.value = withTiming(1, { duration: 620, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    });
  };
  useEffect(() => () => { from.current = null; }, []);

  const box = useAnimatedStyle(() => {
    const w0 = f0 ? f0.w : width;
    const h0 = f0 ? f0.h : h;
    return {
      width: w0 + (width - w0) * p.value,
      height: h0 + (h - h0) * p.value,
      transform: [{ translateX: dx.value * (1 - p.value) }, { translateY: dy.value * (1 - p.value) }],
    };
  });
  const tall = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, p.value * 2.6) }));
  const wide = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, (p.value - 0.25) * 2.2)) }));

  if (!f0 || still) return <NeonCard c={c} width={width} hide={hide} />;
  return (
    <Animated.View ref={ref} collapsable={false} onLayout={onLayout} style={[{ borderRadius: R, overflow: 'hidden', zIndex: 2 }, box]}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, wide]}>
        <NeonCard c={c} width={width} hide={hide} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, tall]} pointerEvents="none">
        <NeonCard c={c} width={f0.w} height={f0.h} hide={hide} />
      </Animated.View>
    </Animated.View>
  );
}
