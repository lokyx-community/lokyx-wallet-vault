import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { T } from './Text';
import { C, F } from './theme';
import { EASE_IN_OUT, EASE_OUT } from './motion';
import { shortAddr } from '../lib/format';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const COIN = 50;
const CHIP_W = 224;
const CHIP_H = 46;
const MINI = 30;

const bez = (u: number, a: number, b: number, c: number, d: number) => {
  'worklet';
  const m = 1 - u;
  return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d;
};
const ease = (p: number) => {
  'worklet';
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};

export type LaunchStage = 'sending' | 'waiting' | 'done' | 'failed';

/**
 * What happens after you confirm a payment. Your own ring folds, ray by ray, into the coin. The coin crosses to the
 * other address on one thin arc, with a fine trail behind it. The other address answers once, its little ring turns into
 * a check, and the amount settles where your ring was. Nothing bounces. It starts the moment the payment is accepted; while
 * it is still being signed the ring only breathes, and if the payment fails nothing leaves the screen.
 */
export function CoinLaunch({ stage, to, ring, toRing, coin, headline, caption }: {
  stage: LaunchStage;
  to: string;
  /** your own ring, with the coin's mark in the middle, at the size asked for (null when the coin has no ring) */
  ring: ((size: number) => ReactNode) | null;
  /** the other address as a tiny ring (null for a chain that has none) */
  toRing: ((size: number) => ReactNode) | null;
  coin: (size: number) => ReactNode;
  headline: string;
  caption: string;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [still, setStill] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);
  const fold = useSharedValue(0);
  const lift = useSharedValue(0);
  const fly = useSharedValue(0);
  const ans = useSharedValue(0);
  const txt = useSharedValue(0);
  const breath = useSharedValue(0);
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    breath.value = withRepeat(withSequence(withTiming(1, { duration: 1800 }), withTiming(0, { duration: 1800 })), -1);
  }, [breath]);

  const arrive = () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };
  useEffect(() => {
    if (launched || stage === 'sending') return;
    if (stage === 'failed') {
      txt.value = withTiming(1, { duration: 500, easing: EASE_OUT });
      return;
    }
    setLaunched(true);
    if (still) {
      fold.value = lift.value = fly.value = ans.value = txt.value = 1;
      return;
    }
    fold.value = withTiming(1, { duration: 1500, easing: EASE_IN_OUT });
    lift.value = withDelay(1500, withTiming(1, { duration: 700, easing: EASE_IN_OUT }));
    fly.value = withDelay(2300, withTiming(1, { duration: 1900, easing: EASE_IN_OUT }, (fin) => { if (fin) runOnJS(arrive)(); }));
    ans.value = withDelay(4300, withTiming(1, { duration: 1400, easing: EASE_OUT }));
    txt.value = withDelay(5300, withTiming(1, { duration: 700, easing: EASE_OUT }));
  }, [stage, launched, still]); // eslint-disable-line react-hooks/exhaustive-deps

  const { w, h } = box;
  const S = Math.min(280, Math.max(0, w - 48));
  const k = w / 360 || 1;
  const cx = w / 2;
  const cy = h * 0.5;
  const tx = cx - CHIP_W / 2 + 9 + MINI / 2;
  const ty = 8 + CHIP_H / 2;
  const P = useMemo(() => ({ x: [cx, cx + 140 * k, cx - 120 * k, tx], y: [cy, cy - 0.2 * h, cy - 0.42 * h, ty + 4] }), [cx, cy, k, h, tx, ty]);
  const path = `M${P.x[0]} ${P.y[0]} C${P.x[1]} ${P.y[1]} ${P.x[2]} ${P.y[2]} ${P.x[3]} ${P.y[3]}`;
  const len = useMemo(() => {
    let l = 0;
    let px = P.x[0];
    let py = P.y[0];
    for (let i = 1; i <= 40; i++) {
      const u = i / 40;
      const x = bez(u, P.x[0], P.x[1], P.x[2], P.x[3]);
      const y = bez(u, P.y[0], P.y[1], P.y[2], P.y[3]);
      l += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    return l;
  }, [P]);
  const seg = len * 0.32;

  const ringStyle = useAnimatedStyle(() => {
    const f = ease(fold.value);
    return { opacity: 1 - Math.pow(f, 1.5), transform: [{ scale: (1 + 0.012 * breath.value * (1 - f)) * (1 - 0.9 * f) }, { rotate: `${-f * 40}deg` }] };
  });
  const coinStyle = useAnimatedStyle(() => {
    const u = ease(fly.value);
    const x = bez(u, P.x[0], P.x[1], P.x[2], P.x[3]);
    const y = bez(u, P.y[0], P.y[1], P.y[2], P.y[3]) - 10 * ease(lift.value) * (1 - u);
    const appear = Math.min(1, Math.max(0, (fold.value - 0.5) / 0.4));
    const gone = 1 - Math.min(1, Math.max(0, (u - 0.93) / 0.07));
    return { opacity: appear * gone, transform: [{ translateX: x - COIN / 2 }, { translateY: y - COIN / 2 }, { scale: 1.06 * (1 - 0.5 * u) }] };
  });
  const trailProps = useAnimatedProps(() => ({ strokeDasharray: [seg, len * 2] as number[], strokeDashoffset: seg - ease(fly.value) * (len + seg * 0.2) }));
  const trailStyle = useAnimatedStyle(() => ({ opacity: fly.value > 0.02 && fly.value < 0.99 ? 1 : 0 }));
  const miniStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.35 * Math.sin(Math.PI * Math.min(1, ans.value)) }], opacity: 1 - Math.min(1, Math.max(0, (ans.value - 0.45) / 0.3)) }));
  const checkStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (ans.value - 0.5) / 0.5));
    return { opacity: p, transform: [{ scale: 0.7 + 0.3 * p }] };
  });
  const ripple = useAnimatedStyle(() => {
    const p = ans.value;
    const d = 30 + p * 190;
    return { opacity: p > 0 && p < 1 ? 0.28 * (1 - p) : 0, width: d, height: d, borderRadius: d / 2, left: tx - d / 2, top: ty - d / 2 };
  });
  const textStyle = useAnimatedStyle(() => ({ opacity: txt.value, transform: [{ translateY: 12 * (1 - txt.value) }] }));
  const failed = stage === 'failed';

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && (
        <>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', borderWidth: 1, borderColor: '#fff' }, ripple]} />
          <View style={{ position: 'absolute', top: 8, left: (w - CHIP_W) / 2, width: CHIP_W, height: CHIP_H, borderRadius: CHIP_H / 2, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.16)', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 9, paddingRight: 16 }}>
            <View style={{ width: MINI, height: MINI }}>
              <Animated.View style={[{ position: 'absolute' }, miniStyle]}>{toRing ? toRing(MINI) : <View style={{ width: MINI, height: MINI, borderRadius: MINI / 2, borderWidth: 1, borderColor: C.faint }} />}</Animated.View>
              <Animated.View style={[{ position: 'absolute' }, checkStyle]}>
                <Svg width={MINI} height={MINI} viewBox="0 0 30 30">
                  <Path d="M15 2a13 13 0 1 1 0 26a13 13 0 1 1 0-26z" stroke={C.good} strokeWidth={1.4} fill="none" />
                  <Path d="M9.5 15.5l4 4 7-8" stroke={C.good} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </Svg>
              </Animated.View>
            </View>
            <T style={{ fontFamily: F.mono, fontSize: 13, color: C.soft, letterSpacing: 0.2 }} numberOfLines={1}>{shortAddr(to, 6, 4)}</T>
          </View>
          {ring ? (
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: cx - S / 2, top: cy - S / 2, width: S, height: S }, ringStyle]}>
              {ring(S)}
            </Animated.View>
          ) : null}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: w, height: h }, trailStyle]}>
            <Svg width={w} height={h}>
              <AnimatedPath d={path} stroke="#fff" strokeOpacity={0.14} strokeWidth={4} strokeLinecap="round" fill="none" animatedProps={trailProps} />
              <AnimatedPath d={path} stroke="#fff" strokeOpacity={0.6} strokeWidth={1.3} strokeLinecap="round" fill="none" animatedProps={trailProps} />
            </Svg>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: COIN, height: COIN, borderRadius: COIN / 2, backgroundColor: '#050506', borderWidth: 0.6, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }, coinStyle]}>
            {coin(30)}
          </Animated.View>
          <Animated.View style={[{ position: 'absolute', left: 24, right: 24, top: cy - 70, alignItems: 'center', gap: 6 }, textStyle]}>
            <T style={{ fontFamily: F.regular, fontSize: 40, letterSpacing: -1.4, color: failed ? C.bad : C.text }}>{failed ? 'Not sent' : headline}</T>
            <T v="sub" dim style={{ textAlign: 'center', paddingTop: 6 }}>{caption}</T>
          </Animated.View>
          {stage === 'sending' ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' }}>
              <T v="sub" dim>Sending</T>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
