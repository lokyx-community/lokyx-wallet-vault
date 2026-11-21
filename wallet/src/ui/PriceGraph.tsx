import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, { Easing, runOnJS, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Press, tick } from './controls';
import { Skeleton } from './Skeleton';
import { C, F } from './theme';
import { fetchChart, SPANS, type Point, type Span } from '../lib/pricechart';
import { money, type Currency } from '../lib/prices-core';

const APath = Animated.createAnimatedComponent(Path);
const H = 130;

const when = (t: number, span: Span) => {
  const d = new Date(t);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  if (span === '1D') return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  if (span === '1Y' || span === 'All') return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  return day;
};

/** The coin's market price. Drag a finger along the line to read the price at any moment. */
export function PriceGraph({ coinId, cur, width }: { coinId: string; cur: Currency; width: number; price?: number }) {
  const [span, setSpan] = useState<Span>('1W');
  const [data, setData] = useState<Point[] | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const inner = width - 32;
  useEffect(() => {
    let live = true;
    setData(null);
    setAt(null);
    fetchChart(coinId, cur, span).then((v) => live && setData(v));
    return () => { live = false; };
  }, [coinId, cur, span]);

  const { line, area, len, pts } = useMemo(() => {
    const v = data ?? [];
    if (v.length < 2) return { line: '', area: '', len: 0, pts: [] as [number, number][] };
    const ys = v.map((p) => p[1]);
    const lo = Math.min(...ys), hi = Math.max(...ys), sp = hi - lo || 1, pad = 8;
    const P = v.map((p, i) => [(i / (v.length - 1)) * inner, pad + (1 - (p[1] - lo) / sp) * (H - pad * 2)] as [number, number]);
    let l = 0;
    P.forEach(([x, y], i) => { if (i) l += Math.hypot(x - P[i - 1][0], y - P[i - 1][1]); });
    const d = P.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return { line: d, area: `${d} L${inner} ${H} L0 ${H} Z`, len: Math.ceil(l) + 4, pts: P };
  }, [data, inner]);

  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    if (line) t.value = reduce ? 1 : withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [line, reduce, t]);
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - t.value) }));
  const fill = useAnimatedProps(() => ({ opacity: t.value }));

  const n = data?.length ?? 0;
  const pick = (x: number) => {
    if (n < 2) return;
    const i = Math.max(0, Math.min(n - 1, Math.round((x / inner) * (n - 1))));
    setAt((old) => { if (old !== i) tick(); return i; });
  };
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin((e) => runOnJS(pick)(e.x))
    .onUpdate((e) => runOnJS(pick)(e.x))
    .onFinalize(() => runOnJS(setAt)(null));

  const last = n ? data![n - 1][1] : 0;
  const first = n ? data![0][1] : 0;
  const shown = at != null && data ? data[at][1] : last;
  const pct = first ? ((shown - first) / first) * 100 : 0;
  const up = pct >= 0;
  const cursor = at != null && pts[at] ? pts[at] : null;

  return (
    <View style={{ borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <T style={{ fontFamily: F.regular, fontSize: 28, letterSpacing: -1, fontVariant: ['tabular-nums'] }}>{n ? money(shown, cur) : ''}</T>
        {n ? <T style={{ fontFamily: F.medium, fontSize: 13.5, color: C.sub, fontVariant: ['tabular-nums'] }}>{`${up ? '+' : '−'}${Math.abs(pct).toFixed(2)}% · ${span}`}</T> : null}
      </View>
      <T style={{ fontSize: 12.5, color: C.sub, marginTop: 2, height: 18 }}>{n ? (at != null && data ? when(data[at][0], span) : 'Now') : ''}</T>
      <View style={{ height: H, marginTop: 8, justifyContent: 'center' }}>
        {data === null ? (
          <Skeleton w={inner} h={70} r={14} />
        ) : line ? (
          <GestureDetector gesture={pan}>
            <View>
              <Svg width={inner} height={H}>
                <Defs>
                  <LinearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#fff" stopOpacity="0.16" />
                    <Stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <APath d={area} fill="url(#pg)" animatedProps={fill} />
                <APath d={line} stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${len} ${len}`} animatedProps={stroke} />
                {cursor ? <Line x1={cursor[0]} x2={cursor[0]} y1={0} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={1} /> : null}
                {cursor ? <Circle cx={cursor[0]} cy={cursor[1]} r={5} fill="#fff" /> : pts.length ? <Circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={4} fill="#fff" /> : null}
              </Svg>
            </View>
          </GestureDetector>
        ) : (
          <T v="sub" dim style={{ textAlign: 'center' }}>Can't reach the price feed right now</T>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12 }}>
        {SPANS.map((s) => (
          <Press key={s} haptic={false} scaleTo={0.94} onPress={() => setSpan(s)} accessibilityLabel={`Show ${s}`} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ paddingHorizontal: 14, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: s === span ? '#fff' : 'transparent' }}>
              <T style={{ fontFamily: F.medium, fontSize: 12.5, color: s === span ? '#000' : C.sub }}>{s}</T>
            </View>
          </Press>
        ))}
      </View>
    </View>
  );
}
