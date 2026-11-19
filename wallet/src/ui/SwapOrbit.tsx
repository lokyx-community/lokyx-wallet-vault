import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { CoinLogo } from './CoinLogo';

type Chain = 'btc' | 'eth' | 'lyx';

/**
 * Two coins circling each other while a swap is in progress. Slow and even, no bounce: the one in front is a little
 * larger and brighter, so the pair reads as turning in space. It stands still for people who ask for less motion.
 */
export function SwapOrbit({ a, b, size = 150 }: { a: Chain; b: Chain; size?: number }) {
  const r = size * 0.3;
  const coin = size * 0.34;
  const turn = useSharedValue(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setStill(!!v)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (still) {
      cancelAnimation(turn);
      turn.value = 0;
      return;
    }
    turn.value = withRepeat(withTiming(Math.PI * 2, { duration: 7000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [still, turn]);
  const useSide = (k: 1 | -1) =>
    useAnimatedStyle(() => {
      const t = turn.value;
      const z = k * Math.sin(t);
      return {
        transform: [{ translateX: k * r * Math.cos(t) }, { translateY: k * r * Math.sin(t) * 0.8 }, { scale: 1 + 0.12 * z }],
        opacity: 0.88 + 0.12 * z,
        zIndex: z > 0 ? 3 : 2,
      };
    });
  const sa = useSide(1);
  const sb = useSide(-1);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Swap in progress">
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="2 6" />
      </Svg>
      <Animated.View style={[{ position: 'absolute' }, sa]}><CoinLogo chain={a} size={coin} /></Animated.View>
      <Animated.View style={[{ position: 'absolute' }, sb]}><CoinLogo chain={b} size={coin} /></Animated.View>
    </View>
  );
}
