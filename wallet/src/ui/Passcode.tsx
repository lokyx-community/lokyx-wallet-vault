import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { C } from './theme';
import { Keypad } from './Keypad';
import { failure, success } from './controls';
import type { IconName } from './Icon';
import { EASE_OUT, SPRING, DUR } from './motion';

/** Six dots that fill as you type and shake when it's wrong. */
export function PasscodePad({ title, sub, onDone, bio, onBio, length = 6 }: { title: string; sub?: string; onDone: (pin: string) => Promise<boolean | string> | boolean | string; bio?: IconName; onBio?: () => void; length?: number }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState(sub ?? '');
  const shake = useSharedValue(0);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  useEffect(() => setMsg(sub ?? ''), [sub]);

  const key = async (k: string) => {
    if (k === 'x') return onBio?.();
    const next = k === 'del' ? pin.slice(0, -1) : (pin + k).slice(0, length);
    setPin(next);
    if (next.length === length) {
      const r = await onDone(next);
      if (r === true) {
        success();
        return;
      }
      failure();
      shake.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 60 }), withTiming(-4, { duration: 60 }), withTiming(0, { duration: 120, easing: EASE_OUT }));
      if (typeof r === 'string') setMsg(r);
      setTimeout(() => setPin(''), 260);
    }
  };

  return (
    <View style={{ alignItems: 'center', gap: 28, width: '100%' }}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <T v="title" style={{ textAlign: 'center' }}>{title}</T>
        <T v="sub" dim style={{ textAlign: 'center', minHeight: 19 }}>{msg}</T>
      </View>
      <Animated.View style={[{ flexDirection: 'row', gap: 18, height: 20, alignItems: 'center' }, a]}>
        {Array.from({ length }).map((_, i) => (
          <Dot key={i} on={i < pin.length} />
        ))}
      </Animated.View>
      <Keypad onKey={key} extraIcon={bio} extraLabel="Use Face ID or fingerprint" />
    </View>
  );
}

function Dot({ on }: { on: boolean }) {
  const k = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    k.value = withTiming(on ? 1 : 0, { duration: DUR.fast, easing: EASE_OUT });
  }, [on, k]);
  const a = useAnimatedStyle(() => ({ backgroundColor: k.value > 0.5 ? C.text : 'transparent', transform: [{ scale: 1 + 0.25 * k.value * (1 - k.value) * 4 }] }));
  return <Animated.View style={[{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: C.text }, a]} />;
}
