import { useEffect, useId } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, makeMutable, useAnimatedStyle, useReducedMotion, withRepeat, withTiming } from 'react-native-reanimated';

/**
 * The light behind every page: a few soft colours drifting slowly on black, fading to black at the bottom so the
 * content always sits on a calm dark. It is painted, not blurred (soft gradients, no blur filter), so it looks the
 * same on iPhone and Android and costs almost nothing.
 *
 * One clock drives every page, so when you move between pages the light carries on from where it was instead of
 * starting over. The clock runs round once every 2 minutes; each colour turns a whole number of times in that, so
 * the loop never jumps.
 */
const TAU = Math.PI * 2;
const clock = makeMutable(0);
let users = 0;

const start = () => {
  if (users++ === 0) {
    clock.value = 0;
    clock.value = withRepeat(withTiming(TAU, { duration: 120_000, easing: Easing.linear }), -1, false);
  }
};
const stop = () => {
  if (--users === 0) cancelAnimation(clock);
};

interface Blob {
  /** where it sits, as a fraction of the page width and height */
  x: number;
  y: number;
  /** how far it drifts, in points */
  dx: number;
  dy: number;
  /** whole turns per cycle, and a start angle */
  fx: number;
  fy: number;
  p: number;
  /** size as a fraction of the page width */
  s: number;
  color: string;
  a: number;
}

// The colours are the chain colours seen through glass: blue, green, teal and a little violet.
const BLOBS: Blob[] = [
  { x: 0.0, y: 0.0, dx: 80, dy: 60, fx: 3, fy: 2, p: 0, s: 1.15, color: '10,132,255', a: 0.5 },
  { x: 1.0, y: 0.16, dx: 85, dy: 80, fx: 2, fy: 3, p: 2, s: 1.05, color: '61,214,140', a: 0.42 },
  { x: 0.5, y: 0.42, dx: 120, dy: 60, fx: 2, fy: 3, p: 3, s: 0.95, color: '30,190,210', a: 0.26 },
  { x: 0.55, y: 0.02, dx: 90, dy: 50, fx: 1, fy: 2, p: 4, s: 0.7, color: '150,130,255', a: 0.2 },
];

function Light({ b, w, h, strength }: { b: Blob; w: number; h: number; strength: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const size = Math.round(w * b.s * 1.3);
  const st = useAnimatedStyle(() => ({
    transform: [{ translateX: b.dx * Math.sin(clock.value * b.fx + b.p) }, { translateY: b.dy * Math.sin(clock.value * b.fy + b.p * 0.7) }],
    opacity: 0.88 + 0.12 * Math.sin(clock.value * 4 + b.p),
  }));
  return (
    <Animated.View style={[{ position: 'absolute', left: b.x * w - size / 2, top: b.y * h - size / 2, width: size, height: size }, st]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={`b${id}`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
            <Stop offset="0" stopColor={`rgb(${b.color})`} stopOpacity={b.a * strength} />
            <Stop offset="0.45" stopColor={`rgb(${b.color})`} stopOpacity={b.a * strength * 0.45} />
            <Stop offset="1" stopColor={`rgb(${b.color})`} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#b${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** Sits behind a page's content, taps pass through it. `strength` 1 is Home; pages with a lot of text use less. */
export function Aurora({ strength = 0.6 }: { strength?: number }) {
  const { width, height } = useWindowDimensions();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    start();
    return stop;
  }, [still]);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {BLOBS.map((b, i) => (
        <Light key={i} b={b} w={width} h={height} strength={strength} />
      ))}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0" />
            <Stop offset="0.38" stopColor="#000" stopOpacity="0" />
            <Stop offset="0.66" stopColor="#000" stopOpacity="0.72" />
            <Stop offset="0.88" stopColor="#000" stopOpacity="1" />
            <Stop offset="1" stopColor="#000" stopOpacity="1" />
          </LinearGradient>
          <RadialGradient id={`v${id}`} cx="0.5" cy="0" rx="0.75" ry="0.55">
            <Stop offset="0.5" stopColor="#000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.45" />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#v${id})`} />
        <Rect width={width} height={height} fill={`url(#f${id})`} />
      </Svg>
    </View>
  );
}
