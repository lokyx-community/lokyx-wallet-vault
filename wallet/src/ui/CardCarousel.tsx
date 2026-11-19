import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { tick } from './controls';
import { C } from './theme';

const GAP = 12;

/**
 * Cards in a row you swipe through. The next one peeks in from the right; the card you are on is full size and the
 * ones beside it sit back a little, smaller and dimmer, so there is always one thing in front.
 */
export function CardCarousel({ cards, width, height, index, onIndex }: { cards: ReactNode[]; width: number; height: number; index: number; onIndex: (i: number) => void }) {
  const x = useSharedValue(0);
  const step = width + GAP;
  const last = useRef(index);
  const settle = (i: number) => {
    if (i !== last.current) {
      last.current = i;
      tick();
      onIndex(i);
    }
  };
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      x.value = e.contentOffset.x;
      runOnJS(settle)(Math.max(0, Math.min(cards.length - 1, Math.round(e.contentOffset.x / step))));
    },
  });
  return (
    <View>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, gap: GAP }}
        style={{ marginHorizontal: -16 }}
      >
        {cards.map((c, i) => (
          <Slot key={i} i={i} x={x} step={step} width={width} height={height}>{c}</Slot>
        ))}
      </Animated.ScrollView>
      <Dots n={cards.length} x={x} step={step} />
    </View>
  );
}

function Slot({ i, x, step, width, height, children }: { i: number; x: SharedValue<number>; step: number; width: number; height: number; children: ReactNode }) {
  const st = useAnimatedStyle(() => {
    const d = (x.value - i * step) / step; // 0 when this card is the one in front
    return {
      opacity: interpolate(Math.abs(d), [0, 1], [1, 0.5], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(Math.abs(d), [0, 1], [1, 0.9], Extrapolation.CLAMP) }, { translateY: interpolate(Math.abs(d), [0, 1], [0, 10], Extrapolation.CLAMP) }],
    };
  });
  return <Animated.View style={[{ width, height }, st]}>{children}</Animated.View>;
}

function Dots({ n, x, step }: { n: number; x: SharedValue<number>; step: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, height: 10, alignItems: 'center' }}>
      {Array.from({ length: n }, (_, i) => (
        <Dot key={i} i={i} x={x} step={step} />
      ))}
    </View>
  );
}
function Dot({ i, x, step }: { i: number; x: SharedValue<number>; step: number }) {
  const st = useAnimatedStyle(() => {
    const a = 1 - Math.min(1, Math.abs(x.value / step - i));
    return { width: 6 + a * 12, opacity: 0.35 + a * 0.65 };
  });
  return <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: C.text }, st]} />;
}
