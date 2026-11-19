import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import Animated, { FadeOutUp, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './Text';
import { Icon, type IconName } from './Icon';
import { C } from './theme';
import { DUR, EASE_OUT } from './motion';

type Toast = { id: number; text: string; icon?: IconName };
let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** A small pill that drops in from the top and leaves on its own. */
export function toast(text: string, icon: IconName = 'check') {
  current = { id: Date.now(), text, icon };
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    emit();
  }, 2200);
}

export function ToastHost() {
  const t = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => current);
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center', zIndex: 100 }}>
      {t && (
        <Animated.View
          key={t.id}
          entering={SlideInUp.duration(DUR.base).easing(EASE_OUT)}
          exiting={FadeOutUp.duration(200)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 44, borderRadius: 22, backgroundColor: C.fill2, borderWidth: 1, borderColor: C.line2 }}
        >
          {t.icon && <Icon name={t.icon} size={17} color={C.text} width={2.2} />}
          <T v="callout">{t.text}</T>
        </Animated.View>
      )}
    </View>
  );
}
