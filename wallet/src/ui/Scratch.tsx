import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { T } from './Text';
import { F } from './theme';
import { EASE_OUT } from './motion';

const COLS = 14;
const ROWS = 9;
const NEED = 0.55; // once this much is rubbed off, the rest clears itself

/**
 * A foil laid over whatever is below it. Rub it with a finger and it wears away in small patches; past about half,
 * the rest fades. `onRevealed` fires once. Anything under the foil is already on screen, so the reveal is only a cover.
 * Without a gesture to use (or with reduced motion) a tap clears it.
 */
export function Scratch({ width, height, radius = 24, label = 'SCRATCH TO OPEN', onRevealed, children }: { width: number; height: number; radius?: number; label?: string; onRevealed?: () => void; children: React.ReactNode }) {
  const [gone, setGone] = useState<Set<number>>(() => new Set());
  const [done, setDone] = useState(false);
  const fade = useSharedValue(1);
  const fired = useRef(false);
  const cw = width / COLS;
  const ch = height / ROWS;
  const total = COLS * ROWS;

  const rub = (x: number, y: number) => {
    const c0 = Math.floor(x / cw);
    const r0 = Math.floor(y / ch);
    setGone((prev) => {
      const next = new Set(prev);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const c = c0 + dc;
          const r = r0 + dr;
          if (c >= 0 && c < COLS && r >= 0 && r < ROWS) next.add(r * COLS + c);
        }
      return next.size === prev.size ? prev : next;
    });
  };
  const tick = () => Haptics.selectionAsync().catch(() => {});
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          runOnJS(rub)(e.x, e.y);
        })
        .onUpdate((e) => {
          runOnJS(rub)(e.x, e.y);
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
        .onEnd(() => runOnJS(tick)()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cw, ch],
  );

  useEffect(() => {
    if (done || fired.current || gone.size / total < NEED) return;
    fired.current = true;
    fade.value = withTiming(0, { duration: 600, easing: EASE_OUT }, (ok) => {
      if (ok) runOnJS(setDone)(true);
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onRevealed?.();
  }, [gone, done, total, fade, onRevealed]);

  const foil = useAnimatedStyle(() => ({ opacity: fade.value }));
  return (
    <View style={{ width, height }}>
      {children}
      {!done ? (
        <GestureDetector gesture={pan}>
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width, height, borderRadius: radius, overflow: 'hidden' }, foil]} accessibilityRole="button" accessibilityLabel="Scratch to reveal the gift">
            {Array.from({ length: total }, (_, i) => {
              const c = i % COLS;
              const r = Math.floor(i / COLS);
              const shade = 196 + Math.round(((c + r) % 5) * 5 + (c / COLS) * 18);
              return gone.has(i) ? null : <View key={i} style={{ position: 'absolute', left: c * cw, top: r * ch, width: cw + 0.5, height: ch + 0.5, backgroundColor: `rgb(${shade - 6},${shade - 2},${shade + 10})` }} />;
            })}
            {gone.size === 0 ? (
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
                <T style={{ fontFamily: F.semibold, fontSize: 13, letterSpacing: 2, color: 'rgba(50,60,100,0.6)' }}>{label}</T>
              </View>
            ) : null}
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}
