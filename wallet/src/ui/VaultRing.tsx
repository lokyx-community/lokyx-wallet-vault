import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { C } from './theme';
import { EASE_OUT } from './motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A ring that draws itself to `frac` (0 to 1) when it appears and eases to the new value when that changes.
 * `breathe` adds a slow, faint glow behind it: the vault is awake and watching.
 */
export function VaultRing({ size, frac, color = C.good, stroke = 8, breathe, children }: { size: number; frac: number; color?: string; stroke?: number; breathe?: boolean; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const p = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(Math.max(0, Math.min(1, frac)), { duration: 1100, easing: EASE_OUT });
  }, [frac, p]);
  useEffect(() => {
    if (breathe) glow.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [breathe, glow]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - p.value) }));
  const halo = useAnimatedStyle(() => ({ opacity: 0.04 + glow.value * 0.14, transform: [{ scale: 1 + glow.value * 0.05 }] }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {breathe ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: stroke + 4, borderColor: color }, halo]} /> : null}
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#1F1F23" strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${len} ${len}`} animatedProps={arc} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children}
    </View>
  );
}
