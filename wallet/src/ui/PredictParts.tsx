import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedProps, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { T } from './Text';
import { OddsRing } from './OddsRing';
import { Press } from './controls';
import { Spark } from './Spark';
import { C, F } from './theme';
import { EASE_OUT } from './motion';
import { amountText, bestAsk, bestBid, chance, shareMath, type Ladder, type Point } from '../lib/predict-core';
import type { Market } from '../lib/predict';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);
const GREEN = C.good;
const RED = C.bad;

/** "62¢" for a price, "—" when nobody has put one up. */
export const centsText = (p: number | null) => (p === null ? '—' : `${Math.round(p)}¢`);

/**
 * The price of Yes over time. The line draws itself in; a finger held on it shows the price at that moment
 * (`onScrub` gets the point, or null when the finger lifts). Fewer than two points shows a quiet note instead.
 */
export function ChanceChart({ points, height = 176, onScrub }: { points: Point[]; height?: number; onScrub?: (p: Point | null) => void }) {
  const [w, setW] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const draw = useSharedValue(0);
  const pulse = useSharedValue(0);
  const key = `${points.length}-${points[0]?.at ?? 0}-${points[points.length - 1]?.price ?? 0}`;
  useEffect(() => {
    draw.value = 0;
    draw.value = withTiming(1, { duration: 800, easing: EASE_OUT });
  }, [key, draw]);
  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), -1, false);
  }, [pulse]);

  const geo = useMemo(() => {
    if (points.length < 2 || w <= 0) return null;
    const prices = points.map((p) => p.price);
    const lo = Math.max(0, Math.min(...prices) - 6);
    const hi = Math.min(100, Math.max(...prices) + 6);
    const span = Math.max(12, hi - lo);
    const top = 14;
    const bottom = height - 14;
    const xy = points.map((p, i): [number, number] => [(i / (points.length - 1)) * w, bottom - ((p.price - lo) / span) * (bottom - top)]);
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    let len = 0;
    for (let i = 1; i < xy.length; i++) len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    const up = prices[prices.length - 1] >= prices[0];
    return { xy, line, fill: `${line} L${w} ${height} L0 ${height} Z`, len: Math.ceil(len) + 2, lo, hi: lo + span, up };
  }, [points, w, height]);

  const color = geo ? (geo.up ? GREEN : RED) : C.sub;
  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: (geo?.len ?? 0) * (1 - draw.value) }));
  const fillProps = useAnimatedProps(() => ({ opacity: draw.value }));
  const ringProps = useAnimatedProps(() => ({ r: 4 + pulse.value * 12, opacity: draw.value * (1 - pulse.value) * 0.5 }));

  const scrub = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin((e) => runOnJS(pick)(e.x))
    .onUpdate((e) => runOnJS(pick)(e.x))
    .onFinalize(() => runOnJS(pick)(null));
  function pick(x: number | null) {
    if (x === null || !geo) {
      setAt(null);
      onScrub?.(null);
      return;
    }
    const i = Math.max(0, Math.min(points.length - 1, Math.round((x / w) * (points.length - 1))));
    setAt(i);
    onScrub?.(points[i]);
  }

  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {!geo ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: C.fill }}>
          <T v="sub" dim>{points.length === 1 ? 'Only one trade so far' : 'No trades yet'}</T>
        </View>
      ) : (
        <GestureDetector gesture={scrub}>
          <View>
            <Svg width={w} height={height}>
              <Defs>
                <LinearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={color} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={color} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {[0.25, 0.5, 0.75].map((f) => (
                <Line key={f} x1={0} x2={w} y1={14 + f * (height - 28)} y2={14 + f * (height - 28)} stroke="#fff" strokeOpacity={0.06} strokeDasharray="3 6" />
              ))}
              <APath d={geo.fill} fill="url(#cf)" animatedProps={fillProps} />
              <APath d={geo.line} stroke={color} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${geo.len} ${geo.len}`} animatedProps={lineProps} />
              {at === null ? (
                <>
                  <ACircle cx={geo.xy[geo.xy.length - 1][0]} cy={geo.xy[geo.xy.length - 1][1]} fill={color} animatedProps={ringProps} />
                  <Circle cx={geo.xy[geo.xy.length - 1][0] - 1} cy={geo.xy[geo.xy.length - 1][1]} r={4} fill={color} />
                </>
              ) : (
                <>
                  <Line x1={geo.xy[at][0]} x2={geo.xy[at][0]} y1={0} y2={height} stroke="#fff" strokeOpacity={0.35} />
                  <Circle cx={geo.xy[at][0]} cy={geo.xy[at][1]} r={5} fill={color} stroke="#000" strokeWidth={2} />
                </>
              )}
            </Svg>
            <T v="caption" dim style={{ position: 'absolute', right: 0, top: 0 }}>{Math.round(geo.hi)}¢</T>
            <T v="caption" dim style={{ position: 'absolute', right: 0, bottom: 0 }}>{Math.round(geo.lo)}¢</T>
          </View>
        </GestureDetector>
      )}
    </View>
  );
}

/** The two big choices on a market: Yes and No, each with what a share costs right now. */
export function YesNo({ yes, no, unit, decimals, symbol, onYes, onNo, disabled }: { yes: number | null; no: number | null; unit: bigint; decimals: number; symbol: string; onYes: () => void; onNo: () => void; disabled?: boolean }) {
  const side = (label: string, price: number | null, color: string, tint: string, on: () => void) => {
    const m = price === null ? null : shareMath(price, unit);
    const off = disabled || price === null;
    return (
      <Press
        onPress={on}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={m ? `Bet ${label}: ${coinText(m.cost, decimals, symbol)} a share, wins ${coinText(unit, decimals, symbol)} if ${label} is right` : `Bet ${label}: no offers yet`}
        style={{ flex: 1, borderRadius: 26, backgroundColor: tint, borderWidth: 1, borderColor: color + '55', padding: 16, gap: 4, opacity: off ? 0.45 : 1 }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 20, letterSpacing: -0.3, color }}>{label}</T>
          <T v="caption" dim>{price === null ? 'no offers' : `${Math.round(price)}% chance`}</T>
        </View>
        <T style={{ fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.8, paddingTop: 6 }}>{m ? amountText(m.cost, decimals, 2) : '—'}</T>
        <T v="caption" dim>{m ? `${symbol} a share` : 'Nobody is offering this yet'}</T>
        {m ? <T v="caption" style={{ paddingTop: 6, lineHeight: 17, color: C.sub }}>{`Win ${coinText(unit, decimals, symbol)} if ${label === 'Yes' ? 'it happens' : 'it does not'}. Profit ${coinText(m.profit, decimals, symbol)} a share.`}</T> : null}
        <View style={{ marginTop: 10, height: 40, borderRadius: 20, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: F.semibold, fontSize: 14.5, color: '#04110a' }}>{`Bet ${label}`}</T>
        </View>
      </Press>
    );
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {side('Yes', yes, GREEN, 'rgba(61,214,140,0.10)', onYes)}
        {side('No', no, RED, 'rgba(255,92,92,0.10)', onNo)}
      </View>
      <View style={{ borderRadius: 20, backgroundColor: C.fill, padding: 14 }}>
        <T v="caption" dim style={{ lineHeight: 18 }}>
          {`How it works: a share pays ${coinText(unit, decimals, symbol)} if you are right and nothing if you are wrong. The price is what everyone together thinks the chance is. You can sell your shares before it closes.`}
        </T>
      </View>
    </View>
  );
}

/** One market in the list: the question, the chance of Yes, a week of price, and where it is in its life. */
export function MarketCard({ m, ladder, spark, line, onPress }: { m: Market; ladder: Ladder | null; spark: number[]; line: string; onPress: () => void }) {
  const ch = ladder ? chance(ladder) : null;
  return (
    <Press onPress={onPress} scaleTo={0.985} style={{ borderRadius: 26, backgroundColor: C.fill, padding: 18, gap: 14 }}>
      <T style={{ fontFamily: F.semibold, fontSize: 18, letterSpacing: -0.3, lineHeight: 23 }} numberOfLines={3}>{m.title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <OddsRing pct={ch} />
          <T v="caption" dim>chance of Yes</T>
        </View>
        <Spark data={spark} width={118} height={44} color={spark.length > 1 && spark[spark.length - 1] < spark[0] ? RED : GREEN} fill="rgba(255,255,255,0.04)" />
      </View>
      <T v="caption" dim>{line}</T>
    </Press>
  );
}

/** The waiting offers as a ladder: what Yes can be bought for (green) and sold for (red), with a bar for how many. */
export function BookLadder({ l, rows = 5 }: { l: Ladder; rows?: number }) {
  const asks = l.asks.slice(0, rows);
  const bids = l.bids.slice(0, rows);
  const max = Math.max(1, ...[...asks, ...bids].map((x) => Number(x.qty)));
  const row = (price: number, qty: bigint, color: string, key: string) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', height: 28 }}>
      <View style={{ position: 'absolute', right: 0, top: 3, bottom: 3, width: `${Math.max(6, (Number(qty) / max) * 100)}%`, backgroundColor: color + '22', borderRadius: 6 }} />
      <T style={{ fontFamily: F.mono, fontSize: 13, color, width: 54, paddingLeft: 8 }}>{price}¢</T>
      <T style={{ fontFamily: F.mono, fontSize: 13, color: C.soft, marginLeft: 'auto', paddingRight: 8 }}>{qty.toString()}</T>
    </View>
  );
  if (!asks.length && !bids.length) return <T v="sub" dim>No offers yet. Be the first: buy or sell at a price you like.</T>;
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4 }}>
        <T v="caption" dim>Price of Yes</T>
        <T v="caption" dim>Shares</T>
      </View>
      {[...asks].reverse().map((a) => row(a.price, a.qty, RED, `a${a.price}`))}
      <View style={{ height: 1, backgroundColor: C.line2, marginVertical: 4 }} />
      {bids.map((b) => row(b.price, b.qty, GREEN, `b${b.price}`))}
    </View>
  );
}

/** "100.00 USDT" style amount. */
export const coinText = (v: bigint, decimals: number, symbol: string, shown = 2) => `${amountText(v, decimals, shown)} ${symbol}`;

export { bestAsk, bestBid };
