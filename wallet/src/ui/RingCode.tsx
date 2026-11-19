import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { addressToBytes } from '../lib/lokyx';
import { sunLevels, sunPaths } from '../lib/sun';
import { C } from './theme';
import { Mark } from './Icon';
import { Signet } from './Signet';
import { DUR, EASE_OUT } from './motion';

/** One eighth of the rays. The sun opens clockwise, eighth by eighth, each growing out a little. */
function Eighth({ d, size, stroke, i, play, color }: { d: string; size: number; stroke: number; i: number; play: boolean; color: string }) {
  const t = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) t.value = withDelay(140 + 70 * i, withTiming(1, { duration: 520, easing: EASE_OUT }));
  }, [play, i, t]);
  const a = useAnimatedStyle(() => ({ opacity: Math.min(1, t.value * 1.6), transform: [{ scale: 0.82 + 0.18 * t.value }, { rotate: `${(1 - t.value) * -14}deg` }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, a]}>
      <Svg width={size} height={size}>
        <Path d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** The long ray to the rim, the "this way up" mark. It lands last, with a little overshoot. */
function Mark0({ d, size, stroke, play, color }: { d: string; size: number; stroke: number; play: boolean; color: string }) {
  const t = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) t.value = withDelay(820, withTiming(1, { duration: DUR.slow, easing: EASE_OUT }));
  }, [play, t]);
  const a = useAnimatedStyle(() => ({ opacity: Math.min(1, t.value * 2), transform: [{ scale: 0.7 + 0.3 * t.value }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, a]}>
      <Svg width={size} height={size}>
        <Path d={d} stroke={color} strokeWidth={stroke * 1.15} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** Someone's address as a sun: rays of eight lengths around their signet. The scanner reads it
 *  from any angle. */
export function RingCode({ address, size, play = true, center = true, type, color = C.text }: { address: string; size: number; play?: boolean; center?: boolean; type?: number; color?: string }) {
  const p = useMemo(() => {
    try {
      const art = sunPaths(sunLevels(addressToBytes(address), type), size);
      const per = art.each.length / 8;
      const eighths = Array.from({ length: 8 }, (_, k) => art.each.slice(k * per + (k === 0 ? 1 : 0), (k + 1) * per).join(''));
      return { ...art, eighths, mark: art.each[0] };
    } catch {
      return null;
    }
  }, [address, size, type]);
  const k = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) k.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [play, k, address]);
  const frame = useAnimatedStyle(() => ({ opacity: k.value, transform: [{ scale: 0.96 + 0.04 * k.value }] }));
  if (!p) return <View style={{ width: size, height: size }} />;
  return (
    <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel="Your LOKYX sun code">
      <Animated.View style={[StyleSheet.absoluteFill, frame]}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={p.frame} stroke={color} strokeWidth={p.frameStroke} fill="none" />
        </Svg>
      </Animated.View>
      {p.eighths.map((d, i) => (
        <Eighth key={`${address}${i}`} d={d} size={size} stroke={p.stroke} i={i} play={play} color={color} />
      ))}
      <Mark0 key={`${address}m`} d={p.mark} size={size} stroke={p.stroke} play={play} color={color} />
      {center && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
          {type && type !== 1 ? <Mark size={size * 0.17} color={color} /> : <Signet of={address} size={size * 0.36} bare play={play} color={color} />}
        </View>
      )}
    </View>
  );
}

/** Someone in a list: their signet, or the first letter of a name when there's no address. */
export function Avatar({ address, size = 40, name }: { address?: string; size?: number; name?: string }) {
  if (address) return <Signet of={address} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.fill2, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.Text style={{ color: C.text, fontFamily: 'Geist_600SemiBold', fontSize: size * 0.4 }}>{(name ?? '?').trim().charAt(0).toUpperCase()}</Animated.Text>
    </View>
  );
}

/** The mark, breathing slowly: for waiting moments. */
export function BreathingMark({ size = 64 }: { size?: number }) {
  const k = useSharedValue(0);
  useEffect(() => {
    k.value = withRepeat(withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) })), -1);
  }, [k]);
  const a = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * k.value, transform: [{ scale: 0.96 + 0.06 * k.value }] }));
  return (
    <Animated.View style={a}>
      <Mark size={size} color={C.text} />
    </Animated.View>
  );
}
