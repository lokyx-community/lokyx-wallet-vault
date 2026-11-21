import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { T } from './Text';
import { Press } from './controls';
import { Skeleton } from './Skeleton';
import { C, F } from './theme';
import { fetchChart, SPANS, type Span } from '../lib/pricechart';
import { money, type Currency } from '../lib/prices-core';

const APath = Animated.createAnimatedComponent(Path);

/** The coin's market price over 1D to All. The line draws itself left to right whenever the span changes. */
export function PriceGraph({ coinId, cur, width, price }: { coinId: string; cur: Currency; width: number; price?: number }) {
  const [span, setSpan] = useState<Span>('1W');
  const [data, setData] = useState<number[] | null>(null);
  const reduce = useReducedMotion();
  const h = 120;
  useEffect(() => {
    let live = true;
    setData(null);
    fetchChart(coinId, cur, span).then((v) => live && setData(v));
    return () => { live = false; };
  }, [coinId, cur, span]);

  const { line, area, len, first, last } = useMemo(() => {
    const v = data ?? [];
    if (v.length < 2) return { line: '', area: '', len: 0, first: 0, last: 0 };
    const lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1, pad = 8;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * width, pad + (1 - (x - lo) / sp) * (h - pad * 2)] as const);
    let l = 0;
    pts.forEach(([x, y], i) => { if (i) l += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]); });
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return { line: d, area: `${d} L${width} ${h} L0 ${h} Z`, len: Math.ceil(l) + 4, first: v[0], last: v[v.length - 1] };
  }, [data, width]);

  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    if (line) t.value = reduce ? 1 : withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [line, reduce, t]);
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - t.value) }));
  const fill = useAnimatedProps(() => ({ opacity: t.value }));

  const pct = first ? ((last - first) / first) * 100 : 0;
  const up = pct >= 0;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 8 }}>
        <T style={{ fontFamily: F.medium, fontSize: 22, letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}>{price !== undefined ? money(price, cur) : last ? money(last, cur) : ''}</T>
        {last ? <T style={{ fontFamily: F.medium, fontSize: 13.5, color: C.sub, fontVariant: ['tabular-nums'] }}>{`${up ? '+' : '−'}${Math.abs(pct).toFixed(2)}% · ${span}`}</T> : null}
      </View>
      <View style={{ height: h + 20, justifyContent: 'center', borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', paddingVertical: 10 }}>
        {data === null ? (
          <Skeleton w={width} h={60} r={14} />
        ) : line ? (
          <Svg width={width} height={h}>
            <Defs>
              <LinearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#fff" stopOpacity="0.16" />
                <Stop offset="1" stopColor="#fff" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <APath d={area} fill="url(#pg)" animatedProps={fill} />
            <APath d={line} stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${len} ${len}`} animatedProps={stroke} />
          </Svg>
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
