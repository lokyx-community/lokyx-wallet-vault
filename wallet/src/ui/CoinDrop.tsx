import { useEffect } from 'react';
import { useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { T } from './Text';
import { Icon } from './Icon';
import { Logo, logoFor } from './Logo';
import { CoinMark } from './CoinMark';
import { AppsCardArt, CARD_H, CARD_W } from './AppsCardArt';
import { C, F } from './theme';
import { EASE_OUT } from './motion';

/** Where the first engraved slot sits on the card, in the card's own units (see AppsCardArt). */
const SLOT = { left: 25, top: 161, size: 34 };

/**
 * "Added": the Apps wallet card rises, a coin of what you added drops into its first slot, a ring ripples out from it,
 * and a tick and the amount settle underneath. About a second and a half, with a light tap as it lands.
 */
export function CoinDrop({ symbol, amount, note }: { symbol: string; amount: string; note: string }) {
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const k = Math.min(1, (width - 40) / CARD_W);
  const rise = useSharedValue(still ? 1 : 0);
  const drop = useSharedValue(still ? 1 : 0);
  const ripple = useSharedValue(still ? 1 : 0);
  const text = useSharedValue(still ? 1 : 0);

  useEffect(() => {
    if (still) return;
    rise.value = withTiming(1, { duration: 520, easing: EASE_OUT });
    drop.value = withDelay(380, withTiming(1, { duration: 640, easing: Easing.bezier(0.3, 0, 0.2, 1) }));
    ripple.value = withDelay(980, withTiming(1, { duration: 800, easing: EASE_OUT }));
    text.value = withDelay(1060, withTiming(1, { duration: 520, easing: EASE_OUT }));
    const t = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 1020);
    return () => clearTimeout(t);
  }, [still, rise, drop, ripple, text]);

  const card = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: (1 - rise.value) * 28 }] }));
  const coin = useAnimatedStyle(() => ({
    opacity: interpolate(drop.value, [0, 0.12, 1], [0, 1, 1]),
    transform: [{ translateY: interpolate(drop.value, [0, 1], [-170, 0]) }, { scale: interpolate(drop.value, [0, 0.85, 1], [1.25, 1.04, 1]) }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(ripple.value, [0, 0.15, 1], [0, 0.7, 0]),
    transform: [{ scale: interpolate(ripple.value, [0, 1], [1, 3.4]) }],
  }));
  const words = useAnimatedStyle(() => ({ opacity: text.value, transform: [{ translateY: (1 - text.value) * 10 }] }));
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(text.value, [0, 0.6, 1], [0.4, 1.15, 1]) }], opacity: text.value }));

  const logo = logoFor(symbol);
  return (
    <View style={{ alignItems: 'center', gap: 22, paddingTop: 12 }}>
      <Animated.View style={[{ width: CARD_W * k, height: CARD_H * k }, card]}>
        <View style={{ width: CARD_W, height: CARD_H, transform: [{ scale: k }], transformOrigin: 'top left', shadowColor: '#000', shadowOpacity: 0.75, shadowRadius: 22, shadowOffset: { width: 0, height: 22 }, elevation: 14 }}>
          <AppsCardArt coinsShown={[]} />
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: SLOT.left, top: SLOT.top, width: SLOT.size, height: SLOT.size, borderRadius: SLOT.size / 2, borderWidth: 1.5, borderColor: 'rgba(201,160,87,0.9)' }, ring]} />
          <Animated.View style={[{ position: 'absolute', left: SLOT.left, top: SLOT.top, width: SLOT.size, height: SLOT.size, borderRadius: SLOT.size / 2, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, coin]}>
            {logo ? <Logo id={logo} size={SLOT.size} /> : <CoinMark symbol={symbol} seed={symbol} size={SLOT.size} />}
          </Animated.View>
        </View>
      </Animated.View>
      <Animated.View style={[{ alignItems: 'center', gap: 6 }, words]}>
        <Animated.View style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.good, alignItems: 'center', justifyContent: 'center' }, badge]}>
          <Icon name="check" size={20} color="#000" width={3} />
        </Animated.View>
        <T style={{ fontFamily: F.semibold, fontSize: 28, letterSpacing: -0.8 }}>+{amount} {symbol}</T>
        <T v="callout" dim style={{ textAlign: 'center', lineHeight: 21 }}>{note}</T>
      </Animated.View>
    </View>
  );
}
