import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Press, tick } from './controls';
import { T } from './Text';
import { C, F } from './theme';
import { DUR, EASE_IN_OUT } from './motion';

/** A row of choices with a sliding highlight. */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: [K, string][]; onChange: (k: K) => void }) {
  const [w, setW] = useState(0);
  const i = options.findIndex((o) => o[0] === value);
  const seg = (w - 8) / options.length;
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(i * seg, { duration: DUR.base, easing: EASE_IN_OUT }) }] }), [i, seg]);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', height: 40, borderRadius: 20, backgroundColor: C.fill, padding: 4 }}>
      {w > 0 && <Animated.View style={[{ position: 'absolute', top: 4, left: 4, bottom: 4, width: seg, borderRadius: 16, backgroundColor: C.fill2, borderWidth: 1, borderColor: C.line2 }, a]} />}
      {options.map(([k, label]) => (
        <Press
          key={k}
          haptic={false}
          scaleTo={0.95}
          accessibilityRole="tab"
          accessibilityState={{ selected: k === value }}
          onPress={() => {
            if (k !== value) tick();
            onChange(k);
          }}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <T style={{ fontFamily: F.medium, fontSize: 13.5, color: k === value ? C.text : C.sub }}>{label}</T>
        </Press>
      ))}
    </View>
  );
}
