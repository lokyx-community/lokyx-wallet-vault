import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';
import { DUR, EASE_OUT, SOFT } from './motion';

/** A card that rises from the bottom over a dimmed screen. Drag it down or tap outside to close. */
export function Sheet({ open, onClose, children, dismissable = true }: { open: boolean; onClose: () => void; children: ReactNode; dismissable?: boolean }) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  // The keyboard opens over a Modal on Android and iPhone alike, so the sheet lifts itself by the
  // keyboard's height. Whatever still doesn't fit scrolls.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const y = useSharedValue(800);
  const dim = useSharedValue(0);
  useEffect(() => {
    if (open) {
      y.value = withSpring(0, SOFT);
      dim.value = withTiming(1, { duration: 260 });
    }
  }, [open, y, dim]);
  const close = () => {
    if (!dismissable) return;
    dim.value = withTiming(0, { duration: 200 });
    y.value = withTiming(800, { duration: 220, easing: Easing.in(Easing.quad) }, () => runOnJS(onClose)());
  };
  const drag = Gesture.Pan()
    .enabled(dismissable)
    .activeOffsetY([-12, 12])
    .failOffsetX([-14, 14])
    .onUpdate((e) => {
      y.value = e.translationY > 0 ? e.translationY : e.translationY / 6;
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) {
        dim.value = withTiming(0, { duration: 180 });
        y.value = withTiming(800, { duration: 200 }, () => runOnJS(onClose)());
      } else y.value = withSpring(0, SOFT);
    });
  const card = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const shade = useAnimatedStyle(() => ({ opacity: dim.value }));
  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.62)' }, shade]}>
          <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close" />
        </Animated.View>
        <View style={{ flex: 1 }} pointerEvents="box-none" />
        <GestureDetector gesture={drag}>
          <Animated.View style={[{ borderTopLeftRadius: 36, borderTopRightRadius: 36, backgroundColor: 'rgba(22,24,28,0.99)', borderTopWidth: 0.6, borderColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 24, paddingTop: 12, paddingBottom: (kb > 0 ? kb : insets.bottom) + 24, width: '100%', maxWidth: 560, alignSelf: 'center' }, card]}>
            <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: 18 }} />
            <ScrollView
              style={{ maxHeight: Math.max(220, screenH - kb - insets.top - 64) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <Animated.View key={open ? 'in' : 'out'} entering={FadeInDown.delay(160).duration(DUR.slow).easing(EASE_OUT)}>{children}</Animated.View>
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}
