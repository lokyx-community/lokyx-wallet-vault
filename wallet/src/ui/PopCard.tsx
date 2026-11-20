import { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Icon } from './Icon';
import { C, F } from './theme';
import { DUR, EASE_OUT } from './motion';

export type PopTone = 'wait' | 'bad';
export interface PopOption {
  label: string;
  /** the filled, first button */
  main?: boolean;
  onPress: () => void;
}

const TINT: Record<PopTone, { fg: string; bg: string }> = {
  wait: { fg: C.wait, bg: 'rgba(245,184,61,0.14)' },
  bad: { fg: C.bad, bg: 'rgba(255,92,92,0.14)' },
};

// A calm overshoot, like an iOS alert arriving.
const POP = { damping: 15, stiffness: 190, mass: 1 } as const;

/**
 * An error, popped up in the middle of the screen: the screen behind blurs, a card springs in with a soft haptic,
 * the badge gives a small shake (like a Face ID miss), then the words and buttons arrive one after another.
 */
export function PopCard({ open, tone = 'wait', title, body, options, onClose }: { open: boolean; tone?: PopTone; title: string; body: string; options: PopOption[]; onClose: () => void }) {
  const t = TINT[tone];
  const scale = useSharedValue(0.82);
  const fade = useSharedValue(0);
  const shake = useSharedValue(0);
  useEffect(() => {
    if (!open) return;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    scale.value = 0.82;
    fade.value = 0;
    scale.value = withSpring(1, POP);
    fade.value = withTiming(1, { duration: 200, easing: EASE_OUT });
    shake.value = withDelay(500, withSequence(withTiming(-5, { duration: 55 }), withTiming(5, { duration: 90 }), withTiming(-3, { duration: 80 }), withTiming(0, { duration: 70, easing: Easing.out(Easing.quad) })));
  }, [open, scale, fade, shake]);
  const card = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ scale: scale.value }] }));
  const shade = useAnimatedStyle(() => ({ opacity: fade.value }));
  const badge = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28 }}>
        <Animated.View style={[StyleSheet.absoluteFill, shade]}>
          {Platform.OS === 'ios' ? <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} /> : null}
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[{ borderRadius: 34, backgroundColor: 'rgba(28,28,31,0.96)', borderWidth: 1, borderColor: C.line2, paddingTop: 30, paddingHorizontal: 24, paddingBottom: 14, alignItems: 'center', width: '100%', maxWidth: 420, alignSelf: 'center' }, card]}
        >
          <Animated.View style={[{ width: 72, height: 72, borderRadius: 36, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }, badge]}>
            <Icon name="info" size={32} color={t.fg} width={2} />
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(180).duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center' }}>
            <T style={{ fontFamily: F.semibold, fontSize: 23, letterSpacing: -0.5, lineHeight: 28, textAlign: 'center' }}>{title}</T>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(260).duration(DUR.base).easing(EASE_OUT)} style={{ alignItems: 'center', marginTop: 10, marginBottom: 22, paddingHorizontal: 4 }}>
            <T v="callout" dim style={{ lineHeight: 21, textAlign: 'center' }}>{body}</T>
          </Animated.View>
          <View style={{ alignSelf: 'stretch' }}>
            {options.map((o, i) => (
              <Animated.View key={o.label} entering={FadeInDown.delay(340 + i * 80).duration(DUR.base).easing(EASE_OUT)}>
                <Pressable
                  onPress={o.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={o.label}
                  style={({ pressed }) => ({ height: o.main ? 50 : 44, marginTop: o.main ? 0 : 4, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: o.main ? C.ink : 'transparent', opacity: pressed ? 0.7 : 1 })}
                >
                  <T v="headline" color={o.main ? C.inkText : C.sub}>{o.label}</T>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
