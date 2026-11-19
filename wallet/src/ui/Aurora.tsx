import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { C } from './theme';

/** A quiet light at the top of a screen: one soft glow that fades into the black. Still, so it never competes with the content. */
export function Aurora({ width, height = 360, strength = 1 }: { width: number; height?: number; strength?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}>
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <Defs>
          <RadialGradient id="g" cx={width / 2} cy={-height * 0.1} rx={width * 0.85} ry={height * 0.85} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.13 * strength} />
            <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0.04 * strength} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="f" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.6" stopColor={C.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={C.bg} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#g)" />
        <Rect width={width} height={height} fill="url(#f)" />
      </Svg>
    </View>
  );
}
