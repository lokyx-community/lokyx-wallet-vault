import { useEffect } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { EASE_OUT } from './motion';
import { C } from './theme';

const NUMS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * One digit as a wheel 0-9 that spins to its value. Only transforms and opacity are animated (no layout
 * animations): Android sometimes skipped the old enter/exit animations and left digits invisible.
 */
function Wheel({ d, style, color, h, intro, order }: { d: number; style: TextStyle; color: string; h: number; intro?: boolean; order: number }) {
  // with `intro` the wheel starts at 0 and rolls up to its digit, one after the other from the left
  const y = useSharedValue(intro ? 0 : -d * h);
  const o = useSharedValue(0);
  useEffect(() => {
    y.value = intro ? withDelay(order * 70, withTiming(-d * h, { duration: 900, easing: EASE_OUT })) : withTiming(-d * h, { duration: 520, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, h, y]);
  useEffect(() => {
    o.value = withTiming(1, { duration: 220 });
  }, [o]);
  const s = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: o.value }));
  return (
    <View style={{ height: h, overflow: 'hidden' }}>
      {/* sizes the slot to this digit's width */}
      <Text style={[style, { lineHeight: h, opacity: 0, fontVariant: ['tabular-nums'] }]}>{NUMS[d]}</Text>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, s]}>
        {NUMS.map((n) => (
          <Text key={n} style={[style, { color, lineHeight: h, height: h, fontVariant: ['tabular-nums'] }]}>
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

/** Numbers that roll like an odometer when they change. */
export function Digits({ text, style, color = C.text, intro }: { text: string; style: TextStyle; up?: boolean; color?: string; intro?: boolean }) {
  // tall enough for Geist's digits, or the wheel's window crops their tops and bottoms
  const h = Math.max((style.lineHeight ?? 0) as number, Math.ceil((style.fontSize ?? 16) * 1.24));
  const chars = text.split('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }} accessible accessibilityLabel={text}>
      {chars.map((ch, i) => {
        // keyed from the right so the ones digit stays the ones digit when the number grows
        const key = chars.length - i;
        return /\d/.test(ch) ? (
          <Wheel key={key} d={Number(ch)} style={style} color={color} h={h} intro={intro} order={i} />
        ) : (
          <Text key={`${key}${ch}`} style={[style, { color, lineHeight: h, height: h }]}>
            {ch}
          </Text>
        );
      })}
    </View>
  );
}
