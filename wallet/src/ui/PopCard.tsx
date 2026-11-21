import { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './Text';
import { Icon } from './Icon';
import { C, F } from './theme';
import { EASE_OUT } from './motion';

export type PopTone = 'wait' | 'bad';
export interface PopOption {
  label: string;
  /** the filled, first button */
  main?: boolean;
  onPress: () => void;
}

const TINT: Record<PopTone, { fg: string; bg: string; line: string }> = {
  wait: { fg: C.wait, bg: 'rgba(245,184,61,0.16)', line: 'rgba(245,184,61,0.45)' },
  bad: { fg: C.bad, bg: 'rgba(255,92,92,0.18)', line: 'rgba(255,107,107,0.45)' },
};

// The pill opens like a drop of ink: quick, with the smallest overshoot.
const OPEN = { damping: 17, stiffness: 200, mass: 1 } as const;
/** An error with one button closes itself after this long, so a small slip never needs a tap. */
const AUTO_MS = 6000;

/**
 * An error. A small dark pill drops from the top, opens into a card that says what happened in plain words and what to
 * do, and the badge gives a short shake. The screen behind dims a little. A card with a single button closes itself.
 */
export function PopCard({ open, tone = 'wait', title, body, options, onClose }: { open: boolean; tone?: PopTone; title: string; body: string; options: PopOption[]; onClose: () => void }) {
  const t = TINT[tone];
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  const p = useSharedValue(0);
  const text = useSharedValue(0);
  const shake = useSharedValue(0);
  const bar = useSharedValue(1);
  const auto = options.length <= 1;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    p.value = 0;
    text.value = 0;
    bar.value = 1;
    p.value = still ? withTiming(1, { duration: 120 }) : withSpring(1, OPEN);
    text.value = withDelay(still ? 0 : 220, withTiming(1, { duration: 260, easing: EASE_OUT }));
    shake.value = withDelay(380, withSequence(withTiming(-6, { duration: 55 }), withTiming(6, { duration: 90 }), withTiming(-4, { duration: 80 }), withTiming(0, { duration: 70, easing: Easing.out(Easing.quad) })));
    let off: ReturnType<typeof setTimeout> | undefined;
    if (auto) {
      bar.value = withDelay(500, withTiming(0, { duration: AUTO_MS, easing: Easing.linear }));
      off = setTimeout(() => closeRef.current(), AUTO_MS + 500);
    }
    return () => off && clearTimeout(off);
  }, [open, auto, still, p, text, shake, bar]);
  const card = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.value * 4),
    transform: [{ translateY: (1 - Math.min(1, p.value)) * -12 }, { scaleX: 0.34 + 0.66 * p.value }, { scaleY: 0.28 + 0.72 * p.value }],
  }));
  const inner = useAnimatedStyle(() => ({ opacity: text.value }));
  const badge = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const progress = useAnimatedStyle(() => ({ width: `${Math.max(0, bar.value) * 100}%` }));
  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1 }} pointerEvents="box-none">
        <Animated.View entering={FadeIn.duration(220)} style={StyleSheet.absoluteFill}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          accessibilityLiveRegion="assertive"
          style={[{ position: 'absolute', top: insets.top + 10, left: 14, right: 14, alignSelf: 'center', maxWidth: 440, borderRadius: 28, backgroundColor: 'rgba(24,19,21,0.98)', borderWidth: 0.6, borderColor: t.line, overflow: 'hidden', transformOrigin: 'top' }, card]}
        >
          <Animated.View style={[{ flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16 }, inner]}>
            <Animated.View style={[{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }, badge]}>
              <Icon name="info" size={18} color={t.fg} width={2.2} />
            </Animated.View>
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: F.semibold, fontSize: 16, lineHeight: 21 }}>{title}</T>
              <T style={{ fontSize: 14, lineHeight: 20, color: C.soft, marginTop: 3 }}>{body}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                {options.map((o) => (
                  <Pressable
                    key={o.label}
                    onPress={o.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    style={({ pressed }) => ({ height: 38, paddingHorizontal: 18, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: o.main ? C.ink : 'rgba(255,255,255,0.1)', opacity: pressed ? 0.7 : 1 })}
                  >
                    <T style={{ fontFamily: F.semibold, fontSize: 14, color: o.main ? C.inkText : C.text }}>{o.label}</T>
                  </Pressable>
                ))}
              </View>
            </View>
          </Animated.View>
          {auto ? <Animated.View style={[{ position: 'absolute', left: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,107,107,0.7)' }, progress]} /> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}
