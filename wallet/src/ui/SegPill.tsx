import { useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Press } from './controls';
import { C, F } from './theme';

/** A glass pill of choices. A white pill slides to the chosen one. */
export function SegPill<K extends string>({ options, value, onChange }: { options: [K, string][]; value: K; onChange: (k: K) => void }) {
  const [w, setW] = useState(0);
  const i = Math.max(0, options.findIndex((o) => o[0] === value));
  const cell = w > 0 ? (w - 8) / options.length : 0;
  const x = useSharedValue(0);
  x.value = withTiming(i * cell, { duration: 320, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  const ind = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 48, borderRadius: 24, padding: 4, flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
      {cell ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 4, top: 4, bottom: 4, width: cell, borderRadius: 20, backgroundColor: '#fff' }, ind]} /> : null}
      {options.map(([k, name]) => (
        <Press key={k} onPress={() => onChange(k)} haptic={false} accessibilityLabel={name} scaleTo={0.97} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: value === k ? F.semibold : F.medium, fontSize: 14, color: value === k ? '#000' : C.soft }}>{name}</T>
        </Press>
      ))}
    </View>
  );
}
