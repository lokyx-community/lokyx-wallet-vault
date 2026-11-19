import { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { C } from './theme';

/** A soft pulsing bar where a value is still loading, so nothing jumps when it arrives. */
export function Skeleton({ w, h, r = 8 }: { w: DimensionValue; h: number; r?: number }) {
  const k = useSharedValue(0.35);
  useEffect(() => {
    k.value = withRepeat(withTiming(0.75, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [k]);
  const s = useAnimatedStyle(() => ({ opacity: k.value }));
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.fill2 }, s]} />;
}

/** What a list looks like while it loads: the same rows it will have, as quiet shapes. */
export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <View style={{ gap: 18, paddingTop: 22 }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Skeleton w={42} h={42} r={21} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton w={i % 2 ? '46%' : '58%'} h={13} />
            <Skeleton w="32%" h={11} />
          </View>
          <Skeleton w={54} h={14} />
        </View>
      ))}
    </View>
  );
}
