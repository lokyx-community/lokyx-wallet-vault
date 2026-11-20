import { Aurora } from '../ui/Aurora';
import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, FadeInDown, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { T } from '../ui/Text';
import { Button } from '../ui/controls';
import { MarkDraw } from '../ui/Intro';
import { SURFACE } from '../ui/WalletCards';
import { Logo } from '../ui/Logo';
import { C, F } from '../ui/theme';
import { DUR, EASE_OUT } from '../ui/motion';

const CW = 150;
const CH = 192;

/** One card of the fan: a coin card's own colours, or frosted glass for the middle one. */
function Card({ kind, glass }: { kind: 'btc' | 'eth' | 'glass'; glass?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = kind === 'glass' ? null : SURFACE[kind];
  return (
    <View style={{ width: CW, height: CH, borderRadius: 28, overflow: 'hidden', backgroundColor: glass ? 'rgba(24,24,32,0.82)' : undefined, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 12 } }}>
      <Svg width={CW} height={CH} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            {s ? s.stops.map(([c, o]) => <Stop key={o} offset={o} stopColor={c} />) : [<Stop key="a" offset={0} stopColor="#5A4FA8" stopOpacity={0.55} />, <Stop key="b" offset={0.5} stopColor="#2A3A7A" stopOpacity={0.35} />, <Stop key="c" offset={1} stopColor="#0E5A66" stopOpacity={0.4} />]}
          </LinearGradient>
          <LinearGradient id={`h${id}`} x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity="0.24" />
            <Stop offset="0.6" stopColor="#fff" stopOpacity="0.02" />
            <Stop offset="1" stopColor="#fff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width={CW} height={CH} fill={`url(#g${id})`} />
        <Rect width={CW} height={CH} fill={`url(#h${id})`} />
        <Rect x={0.5} y={0.5} width={CW - 1} height={CH - 1} rx={27.5} fill="none" stroke="rgba(255,255,255,0.25)" />
      </Svg>
      {kind === 'btc' ? <View style={{ position: 'absolute', left: 16, top: 16 }}><Logo id="btc" size={24} /></View> : null}
      {kind === 'eth' ? <View style={{ position: 'absolute', left: 16, top: 16 }}><Logo id="eth" size={24} /></View> : null}
      {kind === 'glass' ? <View style={{ position: 'absolute', left: 38, right: 38, bottom: 24, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }} /> : null}
    </View>
  );
}

const FAN = [
  { kind: 'btc' as const, x: -62, y: 14, r: -14, at: 0 },
  { kind: 'eth' as const, x: 62, y: 20, r: 13, at: 140 },
  { kind: 'glass' as const, x: 0, y: -8, r: -1, at: 280 },
];

function Fan() {
  const still = useReducedMotion();
  const t = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (!still) t.value = withDelay(1700, withTiming(1, { duration: 1500, easing: EASE_OUT }));
  }, [still, t]);
  return (
    <View style={{ height: 250, alignItems: 'center', justifyContent: 'center' }}>
      {FAN.map((c) => (
        <FanCard key={c.kind} c={c} t={t} />
      ))}
    </View>
  );
}
function FanCard({ c, t }: { c: (typeof FAN)[number]; t: SharedValue<number> }) {
  const st = useAnimatedStyle(() => {
    const p = interpolate(t.value, [c.at / 1500 * 0.5, c.at / 1500 * 0.5 + 0.5], [0, 1], 'clamp');
    return { position: 'absolute', opacity: p, transform: [{ translateX: c.x * p }, { translateY: c.y + (1 - p) * 70 }, { rotate: `${c.r * p}deg` }, { scale: 0.9 + 0.1 * p }] };
  });
  return (
    <Animated.View style={st}>
      <Card kind={c.kind} glass={c.kind === 'glass'} />
    </Animated.View>
  );
}

/** First screen: the mark and name settle, then the fan of cards and the two ways in. */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  const splash = useSharedValue(still ? 0 : 1);
  useEffect(() => {
    if (!still) splash.value = withDelay(1500, withTiming(0, { duration: 600, easing: Easing.out(Easing.quad) }));
  }, [still, splash]);
  const splashStyle = useAnimatedStyle(() => ({ opacity: splash.value }));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }}>
      <Aurora />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14 }}>
        <Svg width={20} height={20} viewBox="0 0 32 32">
          <Path d="M16.74 7.53 A8.5 8.5 0 1 0 24.47 16.74" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" fill="none" />
          <Circle cx={22.5} cy={10.5} r={1.8} fill="#fff" />
        </Svg>
        <T style={{ fontFamily: F.medium, fontSize: 12, letterSpacing: 5, color: C.sub }}>LOKYX</T>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: 26 }}>
        <Fan />
        <Animated.View entering={FadeInDown.delay(1900).duration(DUR.base).easing(EASE_OUT)} style={{ gap: 14 }}>
          <T style={{ fontFamily: F.semibold, fontSize: 44, lineHeight: 52, letterSpacing: -1.8 }}>Your money.{'\n'}Your keys.</T>
          <T v="body" dim style={{ fontSize: 17, lineHeight: 25, maxWidth: 320 }}>
            A wallet for LOKYX. No sign-up, no email. Your keys are made on this phone and stay on it.
          </T>
        </Animated.View>
      </View>
      <Animated.View entering={FadeInDown.delay(2100).duration(DUR.base).easing(EASE_OUT)} style={{ gap: 10 }}>
        <Button title="Create a wallet" onPress={() => router.push('/create')} />
        <Button title="I already have one" kind="plain" onPress={() => router.push('/restore')} />
      </Animated.View>
      {/* the opening: the mark draws itself over the light, then gives way */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 22 }, splashStyle]}>
        <Aurora />
        <MarkDraw size={84} delay={150} color="#fff" />
        <T style={{ fontFamily: F.medium, fontSize: 12, letterSpacing: 6, color: C.sub }}>LOKYX</T>
      </Animated.View>
    </View>
  );
}
