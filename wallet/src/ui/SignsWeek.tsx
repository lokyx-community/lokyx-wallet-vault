import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { Easing, FadeInDown, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { C, F } from './theme';
import { EASE_OUT } from './motion';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);
const ARC = 190;
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** One small LOKYX sign per day: the ring is lit when money came in, the dot when money went out. It draws itself in turn. */
function DaySign({ i, inn, out, today, letter }: { i: number; inn: boolean; out: boolean; today: boolean; letter: string }) {
  const still = useReducedMotion();
  const ring = useSharedValue(still ? 1 : 0);
  const dot = useSharedValue(still ? 1 : 0);
  const grow = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    ring.value = withDelay(500 + i * 130, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }));
    dot.value = withDelay(760 + i * 130, withTiming(1, { duration: 520, easing: EASE_OUT }));
    if (today) grow.value = withDelay(1700, withTiming(1, { duration: 700, easing: EASE_OUT }));
  }, [i, today, still, ring, dot, grow]);
  const rp = useAnimatedProps(() => ({ strokeDashoffset: ARC * (1 - ring.value) }));
  const dp = useAnimatedProps(() => ({ r: 8 * dot.value }));
  const lit = inn || out;
  return (
    <View style={{ alignItems: 'center', width: 34 }}>
      <View style={{ shadowColor: '#fff', shadowOpacity: lit ? 0.5 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, transform: [{ scale: today ? 1.1 : 1 }] }}>
        <Svg width={28} height={28} viewBox="0 0 100 100" fill="none">
          <APath d="M50 16A34 34 0 1 0 84 50" stroke="#fff" strokeOpacity={inn ? 1 : 0.16} strokeWidth={11} strokeLinecap="round" strokeDasharray={`${ARC} ${ARC}`} animatedProps={rp} />
          <ACircle cx={74} cy={26} fill="#fff" fillOpacity={out ? 1 : 0.16} animatedProps={dp} />
        </Svg>
      </View>
      <T style={{ fontSize: 10.5, color: today ? C.text : C.sub, marginTop: 5 }}>{letter}</T>
    </View>
  );
}

function useCountUp(n: number) {
  const [v, setV] = useState(0);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) { setV(n); return; }
    let raf = 0;
    const t0 = Date.now() + 400;
    const step = () => {
      const k = Math.min(1, Math.max(0, (Date.now() - t0) / 1100));
      setV(Math.round(n * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [n, still]);
  return v;
}

/** "This week: 3 in, 2 out" with the seven day signs under it. `days` runs from six days ago to today. */
export function SignsWeek({ inn, out, days, note }: { inn: number; out: number; days: { inn: boolean; out: boolean; letter: string }[]; note?: string }) {
  const a = useCountUp(inn);
  const b = useCountUp(out);
  return (
    <Animated.View entering={FadeInDown.duration(560).easing(EASE_OUT)} style={{ borderRadius: 28, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' }}>
      <T v="caption" dim>This week</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 22, marginTop: 2 }}>
        <T style={{ fontFamily: F.regular, fontSize: 40, letterSpacing: -1.5, fontVariant: ['tabular-nums'] }}>{a}<T style={{ fontSize: 16, color: C.sub, letterSpacing: 0 }}>{'  in'}</T></T>
        <T style={{ fontFamily: F.regular, fontSize: 40, letterSpacing: -1.5, fontVariant: ['tabular-nums'] }}>{b}<T style={{ fontSize: 16, color: C.sub, letterSpacing: 0 }}>{'  out'}</T></T>
      </View>
      {note ? <T v="caption" dim style={{ marginTop: 2 }}>{note}</T> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
        {days.map((d, i) => <DaySign key={i} i={i} inn={d.inn} out={d.out} today={i === days.length - 1} letter={d.letter} />)}
      </View>
    </Animated.View>
  );
}

export const weekLetters = (now = new Date()) => Array.from({ length: 7 }, (_, k) => LETTERS[(now.getDay() - 6 + k + 7) % 7]);
