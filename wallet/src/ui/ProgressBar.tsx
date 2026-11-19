import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { C } from './theme';

/** A thin bar with a line of words above it, for work that takes a few seconds. `value` is 0 to 1. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(Math.max(0.03, Math.min(1, value)), { duration: 220, easing: Easing.out(Easing.quad) });
  }, [value, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={{ gap: 8 }} accessibilityRole="progressbar" accessibilityLabel={`${label} ${pct} percent`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T v="caption" color={C.soft}>{label}</T>
        <T v="caption" dim>{pct}%</T>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.fill2, overflow: 'hidden' }}>
        <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: C.blue }, fill]} />
      </View>
    </View>
  );
}
