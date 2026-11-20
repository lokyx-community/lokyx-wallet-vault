import { useEffect } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { AppsCardArt, CARD_H, CARD_W } from './AppsCardArt';
import type { LogoId } from './logos';
import { DUR, EASE_OUT } from './motion';

/** The Apps wallet card on its own screen: the finished card, rising gently into place each time the screen opens. */
export function AppsCard({ held }: { held?: readonly LogoId[] }) {
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const k = Math.min(1, (width - 40) / CARD_W);
  const rise = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (!still) rise.value = withTiming(1, { duration: DUR.slow + 140, easing: EASE_OUT });
  }, [still, rise]);
  const style = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: (1 - rise.value) * 26 }] }));
  return (
    <Animated.View style={[{ width: CARD_W * k, height: CARD_H * k, alignSelf: 'center' }, style]}>
      <View style={{ width: CARD_W, height: CARD_H, transform: [{ scale: k }], transformOrigin: 'top left', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 20 }, elevation: 14 }}>
        <AppsCardArt coinsShown={held ?? []} />
      </View>
    </Animated.View>
  );
}
