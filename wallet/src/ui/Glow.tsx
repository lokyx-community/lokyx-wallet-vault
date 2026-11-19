import { useId } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/** A soft graphite light behind the top of a page: the LOKYX shade. It never takes a tap and sits under everything. */
export function Glow({ strength = 1, height = 420 }: { strength?: number; height?: number }) {
  const { width } = useWindowDimensions();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={`g${id}`} cx="0.5" cy="0" rx="0.75" ry="0.95" fx="0.5" fy="0">
            <Stop offset="0" stopColor="#A5A8BA" stopOpacity={0.34 * strength} />
            <Stop offset="0.55" stopColor="#A5A8BA" stopOpacity={0.09 * strength} />
            <Stop offset="1" stopColor="#A5A8BA" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#g${id})`} />
      </Svg>
    </View>
  );
}
