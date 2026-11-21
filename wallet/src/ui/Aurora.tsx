import { useEffect, useId } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, makeMutable, useAnimatedStyle, useReducedMotion, withRepeat, withTiming } from 'react-native-reanimated';
import { tiltX, tiltY } from './Tilt';

/**
 * The light behind every page: three slow bands of colour on black that drift by themselves and lean with how the phone is held (see Tilt.tsx), fading to black at the bottom so the
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

interface Ribbon {
  /** where it sits and how big, in points on a 390-wide phone (scaled to the real width) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** resting angle, degrees */
  rot: number;
  /** how far it follows the tilt: sideways and up-down in points, and in degrees of turn. Farther layers move less. */
  px: number;
  py: number;
  pr: number;
  /** whole turns per cycle, so the slow drift never jumps when the clock starts over */
  fx: number;
  fy: number;
  /** the colours along it: where (0 to 1), colour, strength */
  parts: { at: number; c: string; a: number }[];
}

// Three slow bands, far to near: blue, violet and teal across the top, teal and blue under them, a warm band low.
const RIBBONS: Ribbon[] = [
  { x: -120, y: -70, w: 620, h: 200, rot: -14, px: 26, py: 9, pr: 2.6, fx: 8, fy: 7, parts: [{ at: 0.25, c: '40,120,255', a: 0.75 }, { at: 0.55, c: '120,80,255', a: 0.7 }, { at: 0.8, c: '40,220,190', a: 0.65 }] },
  { x: -150, y: 70, w: 660, h: 150, rot: -9, px: 44, py: 14, pr: 1.8, fx: 7, fy: 6, parts: [{ at: 0.3, c: '60,200,170', a: 0.5 }, { at: 0.65, c: '60,120,255', a: 0.55 }, { at: 0.9, c: '150,90,255', a: 0.25 }] },
  { x: -80, y: 190, w: 560, h: 120, rot: -5, px: 62, py: 19, pr: 1.2, fx: 6, fy: 5, parts: [{ at: 0.4, c: '255,150,60', a: 0.3 }, { at: 0.7, c: '255,90,120', a: 0.22 }] },
];

function Band({ r, k, strength, still }: { r: Ribbon; k: number; strength: number; still: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const W = r.w * k;
  const H = r.h * k;
  const st = useAnimatedStyle(() => {
    const tx = still ? 0 : tiltX.value;
    const ty = still ? 0 : tiltY.value;
    const c = clock.value;
    return {
      transform: [
        { translateX: -tx * r.px * k + 7 * k * Math.sin(c * r.fx + r.px) },
        { translateY: ty * r.py * k + 8 * k * Math.cos(c * r.fy + r.px) },
        { rotate: `${r.rot - tx * r.pr * 1.3 + 1.2 * Math.sin(c * 6 + r.px)}deg` },
      ],
    };
  });
  const pw = W * 0.55;
  return (
    <Animated.View style={[{ position: 'absolute', left: r.x * k, top: r.y * k, width: W, height: H }, st]}>
      {r.parts.map((p, i) => (
        <Svg key={i} width={pw} height={H} style={{ position: 'absolute', left: p.at * W - pw / 2, top: 0 }}>
          <Defs>
            <RadialGradient id={`r${id}${i}`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
              <Stop offset="0" stopColor={`rgb(${p.c})`} stopOpacity={p.a * strength} />
              <Stop offset="0.45" stopColor={`rgb(${p.c})`} stopOpacity={p.a * strength * 0.45} />
              <Stop offset="1" stopColor={`rgb(${p.c})`} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width={pw} height={H} fill={`url(#r${id}${i})`} />
        </Svg>
      ))}
    </Animated.View>
  );
}

/** Sits behind a page's content, taps pass through it. `strength` 1 is Home; pages with a lot of text use less. */
export function Aurora({ strength = 1 }: { strength?: number }) {
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
      {RIBBONS.map((r, i) => (
        <Band key={i} r={r} k={width / 390} strength={strength} still={still} />
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
