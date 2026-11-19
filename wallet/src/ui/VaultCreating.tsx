import { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Line, RadialGradient as RG, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutUp,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { T } from './Text';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Button } from './controls';
import { WalletCard, SURFACE, type CardKind } from './WalletCards';
import { C, F } from './theme';
import { EASE_OUT } from './motion';
import type { LogoId } from './logos';

const AnimatedLine = Animated.createAnimatedComponent(Line);

export const CREATE_STEPS = ['checking', 'deploying', 'activating', 'verifying', 'done'] as const;
const WORDS: Record<string, [string, string]> = {
  checking: ['Checking the audited parts', 'Step 1 of 4'],
  deploying: ['Creating your vault', 'Step 2 of 4'],
  activating: ['Switching the protection on', 'Step 3 of 4'],
  verifying: ['Checking it matches what you set', 'Step 4 of 4'],
};
const TICKS = 72;
const PER = 18;
const DIM = '#2A2A2F';
const WHITE = '#F5F5F7';
const GREEN = '#3DD68C';

/** One tick of the ring. It lights, in order, once its quarter's step has really finished. */
function Tick({ i, lit, act, pulse, green, fade }: { i: number; lit: SharedValue<number>[]; act: SharedValue<number>; pulse: SharedValue<number>; green: SharedValue<number>; fade: SharedValue<number> }) {
  const q = Math.floor(i / PER);
  const j = i % PER;
  const a = (i / TICKS) * Math.PI * 2;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const props = useAnimatedProps(() => {
    const w = Math.min(1, Math.max(0, lit[q].value * PER - j));
    const base = act.value === q ? interpolateColor(pulse.value, [0, 1], [DIM, '#5C5C63']) : DIM;
    const on = interpolateColor(w, [0, 1], [base, WHITE]);
    return { stroke: interpolateColor(green.value, [0, 1], [on, GREEN]), opacity: 1 - fade.value };
  });
  return <AnimatedLine x1={120 + 96 * s} y1={120 - 96 * c} x2={120 + 110 * s} y2={120 - 110 * c} strokeWidth={4} strokeLinecap="round" animatedProps={props} />;
}

/**
 * The vault making itself. A ring of ticks goes round the network's mark; each quarter lights when the matching
 * check on the network has really finished, so a slow network means a slower ring. At the end the ticks turn green,
 * a check pops, and the ring becomes the new vault's card.
 */
export function VaultCreating({ net, name, coin, logo, kind, step, onMove, onLater }: { net: string; name: string; coin: string; logo: LogoId; kind: CardKind; step: string; onMove: () => void; onLater: () => void }) {
  void net;
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const at = Math.max(0, CREATE_STEPS.indexOf(step as (typeof CREATE_STEPS)[number]));
  const done = step === 'done';
  const lit = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const act = useSharedValue(0);
  const pulse = useSharedValue(0);
  const green = useSharedValue(0);
  const fade = useSharedValue(0);
  const stageOut = useSharedValue(0);
  const badge = useSharedValue(0);
  const logoPop = useSharedValue(0);
  const card = useSharedValue(0);
  const gleam = useSharedValue(0);
  const tint = useSharedValue(0);
  const btn = useSharedValue(0);
  const seen = useRef(-1);
  const dur = still ? 0 : 1;

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [pulse]);

  useEffect(() => {
    act.value = done ? -1 : at;
    // each quarter lights as its step finishes (a step finishing is the next one starting)
    for (let q = 0; q < Math.min(at, 4); q++) if (q >= seen.current) lit[q].value = withTiming(1, { duration: 900 * dur, easing: Easing.linear });
    if (at > 0 && at !== seen.current) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    seen.current = at;
    if (!done) return;
    const E = { duration: 500 * dur, easing: EASE_OUT };
    green.value = withDelay(900 * dur, withTiming(1, E));
    logoPop.value = withDelay(900 * dur, withTiming(1, { duration: 350 * dur, easing: EASE_OUT }));
    badge.value = withDelay(900 * dur, withTiming(1, { duration: 350 * dur, easing: EASE_OUT }));
    tint.value = withDelay(900 * dur, withTiming(1, { duration: 900 * dur, easing: Easing.inOut(Easing.sin) }));
    fade.value = withDelay(1500 * dur, withTiming(1, { duration: 400 * dur, easing: EASE_OUT }));
    stageOut.value = withDelay(1500 * dur, withTiming(1, { duration: 500 * dur, easing: EASE_OUT }));
    card.value = withDelay(1700 * dur, withTiming(1, { duration: 650 * dur, easing: EASE_OUT }));
    gleam.value = withDelay(2400 * dur, withTiming(1, { duration: 700 * dur, easing: Easing.linear }));
    btn.value = withDelay(2500 * dur, withTiming(1, { duration: 450 * dur, easing: EASE_OUT }));
    const h = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 900 * dur);
    return () => clearTimeout(h);
  }, [at, done, dur]); // eslint-disable-line react-hooks/exhaustive-deps

  const cardW = Math.min(350, width - 40);
  const glow = SURFACE[kind].stops[1][0];
  const stage = useAnimatedStyle(() => ({ opacity: 1 - stageOut.value, transform: [{ scale: 1 - 0.2 * stageOut.value }] }));
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.04 * pulse.value * (done ? 0 : 1) + 0.12 * Math.sin(logoPop.value * Math.PI) }] }));
  const badgeStyle = useAnimatedStyle(() => ({ opacity: badge.value, transform: [{ scale: 0.4 + 0.6 * badge.value }] }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: card.value, transform: [{ translateY: 20 * (1 - card.value) }, { scale: 0.55 + 0.45 * card.value }] }));
  const gleamStyle = useAnimatedStyle(() => ({ opacity: interpolate(gleam.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0]), transform: [{ translateX: -160 + gleam.value * 620 }, { rotate: '18deg' }] }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.value }));
  const btnStyle = useAnimatedStyle(() => ({ opacity: btn.value, transform: [{ translateY: 16 * (1 - btn.value) }] }));
  const [title, sub] = done ? [`Your ${name} vault is ready`, `${coin} and every token on ${name} are protected.`] : WORDS[step] ?? WORDS.checking;

  return (
    <View style={{ height: 640 }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -20, top: -60, width, height: 520 }, tintStyle]}>
        <Svg width={width} height={520}>
          <Defs>
            <RG id="tint" cx={width / 2} cy={156} rx={width * 0.7} ry={312} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={glow} stopOpacity={0.32} />
              <Stop offset="1" stopColor={glow} stopOpacity={0} />
            </RG>
          </Defs>
          <Rect width={width} height={520} fill="url(#tint)" />
        </Svg>
      </Animated.View>

      <Animated.View style={[{ alignSelf: 'center', width: 240, height: 240, marginTop: 0 }, stage]}>
        <Svg width={240} height={240} style={StyleSheet.absoluteFill}>
          {Array.from({ length: TICKS }, (_, i) => (
            <Tick key={i} i={i} lit={lit} act={act} pulse={pulse} green={green} fade={fade} />
          ))}
        </Svg>
        <Animated.View style={[{ position: 'absolute', left: 70, top: 70, width: 100, height: 100 }, logoStyle]}>
          <Logo id={logo} size={100} />
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: 146, top: 146, width: 34, height: 34, borderRadius: 17, backgroundColor: GREEN, borderWidth: 3, borderColor: '#000', alignItems: 'center', justifyContent: 'center' }, badgeStyle]}>
          <Icon name="check" size={18} color="#000" width={2.8} />
        </Animated.View>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 20, alignSelf: 'center' }, cardStyle]}>
        <View style={{ overflow: 'hidden', borderRadius: 26 }}>
          <WalletCard width={cardW} c={{ kind, logo, title: `${name} vault`, sub: 'Protected · 24 h wait', balance: '0.00', unit: coin }} />
          <Animated.View style={[{ position: 'absolute', top: -40, bottom: -40, left: 0, width: 70, backgroundColor: 'rgba(255,255,255,0.28)' }, gleamStyle]} />
        </View>
      </Animated.View>

      <View style={{ position: 'absolute', left: 0, right: 0, top: 300, height: 80 }}>
        <Animated.View key={step} entering={FadeInDown.duration(400).easing(EASE_OUT)} exiting={FadeOutUp.duration(250)} style={StyleSheet.absoluteFill}>
          <T style={{ textAlign: 'center', fontFamily: F.semibold, fontSize: done ? 26 : 22, letterSpacing: done ? -0.7 : -0.6, lineHeight: done ? 32 : 28 }}>{title}</T>
          <T v="callout" dim style={{ textAlign: 'center', paddingTop: 4 }}>{sub}</T>
        </Animated.View>
      </View>

      <View style={{ position: 'absolute', left: 0, right: 0, top: 392, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <Dot key={i} state={done || i < at ? 'done' : i === at ? 'now' : 'next'} passed={i < at && !done} />
        ))}
      </View>

      {!done ? (
        <T v="caption" style={{ position: 'absolute', left: 0, right: 0, top: 448, textAlign: 'center', color: C.faint, lineHeight: 18 }}>Keep LOKYX open. Each step is a real check on the network, so a slow network means a slower ring.</T>
      ) : (
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 470, gap: 4 }, btnStyle]}>
          <Button title="Move coins in" onPress={onMove} />
          <Button title="Later" kind="plain" onPress={onLater} />
        </Animated.View>
      )}
    </View>
  );
}

function Dot({ state, passed }: { state: 'now' | 'next' | 'done'; passed: boolean }) {
  const w = useSharedValue(state === 'now' ? 22 : 6);
  useEffect(() => {
    w.value = withTiming(state === 'now' ? 22 : 6, { duration: 300, easing: EASE_OUT });
  }, [state, w]);
  const st = useAnimatedStyle(() => ({ width: w.value }));
  const bg = state === 'done' && !passed ? GREEN : state === 'next' ? DIM : WHITE;
  return <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: bg }, st]} />;
}
