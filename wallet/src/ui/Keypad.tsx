import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { tick } from './controls';
import { T } from './Text';
import { Icon, type IconName } from './Icon';
import { C } from './theme';

/** One key: a soft ring blooms from it and fades, and the digit dips a touch, so every press is felt before the number lands. */
function Key({ children, label, onPress, size, round }: { children: React.ReactNode; label?: string; onPress: () => void; size: number; round?: boolean }) {
  const ring = useSharedValue(1);
  const dip = useSharedValue(1);
  const bloom = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * 0.9, transform: [{ scale: 0.7 + 0.38 * ring.value }] }));
  const digit = useAnimatedStyle(() => ({ transform: [{ scale: dip.value }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPressIn={() => {
        ring.value = 0;
        ring.value = withTiming(1, { duration: 360, easing: Easing.bezier(0.22, 1, 0.36, 1) });
        dip.value = withTiming(0.88, { duration: 90 });
      }}
      onPressOut={() => {
        dip.value = withTiming(1, { duration: 200, easing: Easing.bezier(0.22, 1, 0.36, 1) });
      }}
      onPress={() => {
        tick();
        onPress();
      }}
      style={{ width: round ? size : '100%', height: size, alignItems: 'center', justifyContent: 'center', borderRadius: size / 2 }}
    >
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: size / 2, backgroundColor: 'rgba(255,255,255,0.16)' }, bloom]} />
      <Animated.View style={digit}>{children}</Animated.View>
    </Pressable>
  );
}

/** A phone-style number pad. `extra` sits bottom-left: a dot for amounts, Face ID for passcodes. */
export function Keypad({ onKey, extra, extraIcon, extraLabel, round }: { onKey: (k: string) => void; extra?: string; extraIcon?: IconName; extraLabel?: string; round?: boolean }) {
  const size = round ? 66 : 64;
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [extra ?? (extraIcon ? 'x' : ''), '0', 'del'],
  ];
  return (
    <View style={{ gap: round ? 10 : 6, width: '100%', maxWidth: 360, alignSelf: 'center' }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {r.map((k, j) =>
            k === '' ? (
              <View key={j} style={{ flex: 1, height: size }} />
            ) : (
              <View key={j} style={{ flex: 1, alignItems: 'center' }}>
                <Key
                  size={size}
                  round={round}
                  label={k === 'del' ? 'Delete' : k === 'x' ? extraLabel : k}
                  onPress={() => onKey(k)}
                >
                  {k === 'del' ? <Icon name="backspace" size={26} color={C.text} /> : k === 'x' && extraIcon ? <Icon name={extraIcon} size={28} color={C.text} /> : <T style={{ fontSize: 32, lineHeight: 40, fontFamily: 'Geist_400Regular', letterSpacing: -0.5 }}>{k}</T>}
                </Key>
              </View>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

/** Applies a key to an amount being typed: one dot, sensible leading zeros, limited decimals. */
export function typeAmount(cur: string, k: string, decimals = 8): string {
  if (k === 'del') return cur.slice(0, -1);
  if (k === '.') return cur.includes('.') ? cur : (cur || '0') + '.';
  if (cur === '0') return k;
  const [, f] = cur.split('.');
  if (f !== undefined && f.length >= decimals) return cur;
  if (cur.replace('.', '').length >= 14) return cur;
  return cur + k;
}
