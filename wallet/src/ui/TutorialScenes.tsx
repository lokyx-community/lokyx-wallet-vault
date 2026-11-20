import { useMemo, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Icon } from './Icon';
import { Logo } from './Logo';
import type { LogoId } from './logos';
import { C, F } from './theme';
import { GRID, STEP, asFn, clamp, eio, eo, ip, lerp, sampled, trail, type Fn, type V } from '../lib/tutorial-motion';
import type { TutorialId } from '../lib/tutorial-core';

// The tutorial pictures. One scene per feature, three steps each, all drawn from the LOKYX look: black glass with a
// thin gold rim, the engraved rings, the ring mark with its gap, real coins. Every moving thing is a function of `u`,
// the seconds into the step (0..STEP), sampled once and played by interpolate.

const GOLD = '#C9A057';
const W = 342;
const H = 250;
const Y0 = 15; // scenes are drawn on a 342x230 sheet; this puts it in the middle of the taller stage
type U = SharedValue<number>;
const sh = (u: U, v: number[]) => {
  'worklet';
  return interpolate(u.value, GRID, v, 'clamp');
};
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

/** Fades (and only fades) whatever is inside. */
function Fade({ u, o = 1, style, children }: { u: U; o?: V; style?: ViewStyle; children?: ReactNode }) {
  const O = useMemo(() => sampled(asFn(o, 1)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ opacity: sh(u, O) }));
  return (
    <Animated.View pointerEvents="none" style={[style ?? StyleSheet.absoluteFill, st]}>
      {children}
    </Animated.View>
  );
}

/** Something whose centre sits at (x, y) and that can move, scale and fade. */
function Mv({ u, x = 0, y = 0, s = 1, o = 1, size, children }: { u: U; x?: V; y?: V; s?: V; o?: V; size: number; children?: ReactNode }) {
  const d = useMemo(() => ({ X: sampled(asFn(x, 0)), Y: sampled(asFn(y, 0)), S: sampled(asFn(s, 1)), O: sampled(asFn(o, 1)) }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({
    opacity: sh(u, d.O),
    transform: [{ translateX: sh(u, d.X) }, { translateY: sh(u, d.Y) }, { scale: sh(u, d.S) }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, alignItems: 'center', justifyContent: 'center' }, st]}>
      {children}
    </Animated.View>
  );
}

function Coin({ u, id, x, y, s, o, size = 26 }: { u: U; id: LogoId; x: V; y: V; s?: V; o?: V; size?: number }) {
  const px = Math.round(size * 1.15);
  return (
    <Mv u={u} x={x} y={y} s={s} o={o} size={px}>
      <Logo id={id} size={px} />
    </Mv>
  );
}

/** A thin gold-or-white ring that fills round, 0..1. */
function Arc({ u, cx, cy, r, sw, f, color = GOLD }: { u: U; cx: number; cy: number; r: number; sw: number; f: V; color?: string }) {
  const Cc = 2 * Math.PI * r;
  const Fv = useMemo(() => sampled(asFn(f, 0)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const p = useAnimatedProps(() => {
    const v = sh(u, Fv);
    return { strokeDashoffset: Cc * (1 - v), opacity: v > 0.01 ? 1 : 0 };
  });
  return (
    <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
      <AnimatedCircle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${Cc} ${Cc}`} rotation={-90} origin={`${cx}, ${cy}`} animatedProps={p} />
    </Svg>
  );
}

/** The LOKYX mark: three quarters of a ring, a gap at the top right, a dot where the gap is. */
function MarkRing({ u, cx, cy, r, sw, color = C.text, o = 1, dot = true }: { u: U; cx: number; cy: number; r: number; sw: number; color?: string; o?: V; dot?: boolean }) {
  return (
    <Fade u={u} o={o}>
      <Svg width={W} height={H}>
        <Path d={`M${cx} ${cy - r} A${r} ${r} 0 1 0 ${cx + r} ${cy}`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        {dot ? <Circle cx={cx + r * 0.707} cy={cy - r * 0.707} r={sw * 0.78} fill={color} /> : null}
      </Svg>
    </Fade>
  );
}

/** A line that can grow, shrink or fade. */
function Ln({ u, x1, y1, x2, y2, color = GOLD, sw = 1.5, dash, o = 1 }: { u: U; x1: V; y1: V; x2: V; y2: V; color?: string; sw?: number; dash?: string; o?: V }) {
  const d = useMemo(() => ({ a: sampled(asFn(x1, 0)), b: sampled(asFn(y1, 0)), c: sampled(asFn(x2, 0)), e: sampled(asFn(y2, 0)), o: sampled(asFn(o, 1)) }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const p = useAnimatedProps(() => ({ x1: sh(u, d.a), y1: sh(u, d.b), x2: sh(u, d.c), y2: sh(u, d.e), opacity: sh(u, d.o) }));
  return (
    <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
      <AnimatedLine stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={dash} animatedProps={p} />
    </Svg>
  );
}

/** Small caps text placed by its baseline. `anchor` says which side of x the text hangs from. */
function Lbl({ u, x, y, t, size = 9.5, ls = 2.4, color = GOLD, anchor = 'start', o = 1 }: { u: U; x: number; y: number; t: string; size?: number; ls?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; o?: V }) {
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - 120 : x - 240;
  return (
    <Fade u={u} o={o} style={{ position: 'absolute', left, top: y - size - 1, width: 240 }}>
      <Text style={{ fontFamily: F.semibold, fontSize: size, letterSpacing: ls, color, textAlign: anchor === 'start' ? 'left' : anchor === 'middle' ? 'center' : 'right', includeFontPadding: false }}>{t}</Text>
    </Fade>
  );
}

const Box = ({ x, y, w, h, r = 0, bg, bc, bw = 1, rot }: { x: number; y: number; w: number; h: number; r?: number; bg?: string; bc?: string; bw?: number; rot?: string }) => (
  <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: r, backgroundColor: bg, borderColor: bc, borderWidth: bc ? bw : 0, transform: rot ? [{ rotate: rot }] : undefined }} />
);
const Spot = ({ cx, cy, r, bg, bc, bw = 1 }: { cx: number; cy: number; r: number; bg?: string; bc?: string; bw?: number }) => <Box x={cx - r} y={cy - r} w={2 * r} h={2 * r} r={r} bg={bg} bc={bc} bw={bw} />;
const Phone = ({ x, y, w, h, color = C.faint }: { x: number; y: number; w: number; h: number; color?: string }) => (
  <>
    <Box x={x} y={y} w={w} h={h} r={9} bg="#101012" bc={color} bw={1.6} />
    <Box x={x + w / 2 - 6} y={y + 5} w={12} h={3} r={1.5} bg={color} />
  </>
);
const At = ({ cx, cy, size, children }: { cx: number; cy: number; size: number; children: ReactNode }) => (
  <View pointerEvents="none" style={{ position: 'absolute', left: cx - size / 2, top: cy - size / 2, width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
);

/** A ripple that spreads from (cx, cy) between t0 and t1. */
function Ripple({ u, cx, cy, r0, r1, t0, t1, color = GOLD }: { u: U; cx: number; cy: number; r0: number; r1: number; t0: number; t1: number; color?: string }) {
  const sc = (v: number) => ip(v, [t0, t1], [1, r1 / r0]);
  return (
    <Mv u={u} x={cx} y={cy} s={sc} o={(v) => ip(v, [t0, t0 + 0.05, t1], [0, 0.85, 0])} size={2 * r0}>
      <View style={{ width: 2 * r0, height: 2 * r0, borderRadius: r0, borderWidth: 1.5, borderColor: color }} />
    </Mv>
  );
}

// ---------------------------------------------------------------- the stage: glass, rings, glow, dust, sweep, zoom

export function Stage({ u, children }: { u: U; children: ReactNode }) {
  const dust = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ x: (i * 61) % W, y0: H - ((i * 43) % H) + 20, speed: 14 + (i % 4) * 7, r: 0.7 + (i % 3) * 0.5, i })), []);
  const zoom = useMemo(() => sampled((v) => 1 + 0.05 * (v / STEP)), []);
  const loop = useMemo(() => sampled((v) => ip(v, [0, 0.25, STEP - 0.3, STEP], [0, 1, 1, 0])), []);
  const glow = useMemo(() => sampled((v) => 0.55 + 0.25 * Math.sin(v * 2.2)), []);
  const sweepX = useMemo(() => sampled((v) => lerp(-140, 480, clamp(v / 1.3))), []);
  const sweepO = useMemo(() => sampled((v) => (v < 1.3 ? 1 : 0)), []);
  const zst = useAnimatedStyle(() => ({ opacity: sh(u, loop), transform: [{ scale: sh(u, zoom) }] }));
  const gst = useAnimatedStyle(() => ({ opacity: sh(u, glow) }));
  const sst = useAnimatedStyle(() => ({ opacity: sh(u, sweepO), transform: [{ translateX: sh(u, sweepX) }, { rotate: '18deg' }] }));
  return (
    <View style={{ width: W, height: H, borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(201,160,87,0.32)', backgroundColor: '#0A0A0B' }}>
      <Svg style={StyleSheet.absoluteFill} width={W} height={H}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#222226" />
            <Stop offset="0.5" stopColor="#121214" />
            <Stop offset="1" stopColor="#060607" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#bg)" />
        {Array.from({ length: 12 }, (_, i) => (
          <Circle key={i} cx={300} cy={40} r={14 + i * 9} fill="none" stroke="#fff" strokeWidth={0.5} opacity={0.07} />
        ))}
      </Svg>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, gst]}>
        <Svg width={W} height={H}>
          <Defs>
            <RadialGradient id="gl" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={GOLD} stopOpacity={0.3} />
              <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={171} cy={125} rx={190} ry={130} fill="url(#gl)" />
        </Svg>
      </Animated.View>
      {dust.map((d) => (
        <Mv key={d.i} u={u} x={d.x} y={(v) => d.y0 - d.speed * v} o={(v) => 0.12 + 0.22 * Math.abs(Math.sin(v * 1.7 + d.i))} size={4}>
          <View style={{ width: 2 * d.r, height: 2 * d.r, borderRadius: d.r, backgroundColor: GOLD }} />
        </Mv>
      ))}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, zst]}>
        <View style={{ position: 'absolute', left: 0, top: Y0, width: W, height: H }}>{children}</View>
      </Animated.View>
      <Text style={{ position: 'absolute', right: 16, bottom: 12, fontFamily: F.semibold, fontSize: 9, letterSpacing: 3.4, color: GOLD, opacity: 0.9, includeFontPadding: false }}>LOKYX</Text>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: -20, width: 70, height: 300 }, sst]}>
        <Svg width={70} height={300}>
          <Defs>
            <LinearGradient id="sw" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#fff" stopOpacity={0} />
              <Stop offset="0.5" stopColor="#fff" stopOpacity={0.16} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={70} height={300} fill="url(#sw)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

type Scene = (p: { k: number; u: U }) => ReactElement;

// ---------------------------------------------------------------- VAULT: the ring is the vault, the gap is the only way out

const Vault: Scene = ({ k, u }) => {
  const cx = 120;
  const cy = 115;
  const r = 54;
  if (k === 0) {
    const q = (v: number) => eo((v - 0.5) / 1.4);
    const qx = (v: number) => lerp(cx, 282, q(v));
    const qy = (v: number) => lerp(cy, 48, q(v));
    return (
      <>
        <MarkRing u={u} cx={cx} cy={cy} r={r} sw={9} />
        <Coin u={u} id="usdc" x={cx - 14} y={cy + 8} />
        <Coin u={u} id="sol" x={cx + 14} y={cy + 12} />
        <Coin u={u} id="usdt" x={cx} y={cy - 12} o={(v) => 1 - ip(v, [0.4, 0.5], [0, 1])} />
        <Ln u={u} x1={cx + r * 0.7} y1={cy - r * 0.7} x2={qx} y2={qy} dash="2 5" o={(v) => (q(v) > 0 ? 0.8 : 0)} />
        {[4, 3, 2, 1].map((g) => (
          <Coin key={g} u={u} id="usdt" x={(v) => qx(v - trail(g).delay)} y={(v) => qy(v - trail(g).delay)} s={trail(g).shrink} o={(v) => (v - trail(g).delay > 0.5 ? trail(g).fade : 0)} />
        ))}
        <Coin u={u} id="usdt" x={qx} y={qy} o={(v) => ip(v, [0.38, 0.42], [0, 1])} />
        <Spot cx={282} cy={48} r={16} bc={GOLD} bw={1.2} />
        <At cx={282} cy={48} size={18}><Icon name="shield" size={15} color={GOLD} width={1.8} /></At>
        <Ripple u={u} cx={282} cy={48} r0={16} r1={46} t0={1.75} t1={2.6} />
        <Lbl u={u} x={24} y={212} t="DAILY ALLOWANCE" />
      </>
    );
  }
  if (k === 1) {
    const out = (v: number) => eo((v - 0.2) / 0.7) * (1 - eo((v - 2.7) / 0.7));
    const f = (v: number) => ip(v, [0.9, 2.5, 2.7, 3.4], [0, 1, 1, 0]);
    const ids: LogoId[] = ['btc', 'sol', 'usdc'];
    return (
      <>
        <MarkRing u={u} cx={cx} cy={cy} r={r} sw={9} />
        <Arc u={u} cx={cx} cy={cy} r={r + 13} sw={3} f={f} />
        {[-16, 0, 16].map((d, i) => (
          <Coin key={i} u={u} id={ids[i]} x={(v) => lerp(cx + d, lerp(cx, cx + r * 0.9, out(v)) + d * 0.15, out(v))} y={(v) => lerp(cy + 14 - Math.abs(d) * 0.3, lerp(cy + 8, cy - r * 0.9, out(v)) + i * 3, out(v))} />
        ))}
        <Lbl u={u} x={cx + r + 30} y={cy + 4} t="WAITING" size={11} o={(v) => (v > 2.7 ? 0 : 1)} />
        <Lbl u={u} x={cx + r + 30} y={cy + 4} t="CANCELLED" size={11} o={(v) => (v > 2.7 ? 1 : 0)} />
        <Lbl u={u} x={24} y={212} t="BIGGER MOVES WAIT" />
      </>
    );
  }
  return (
    <>
      <Phone x={232} y={78} w={52} h={92} color={C.text} />
      <Spot cx={258} cy={124} r={6} bg={C.text} />
      <Ln u={u} x1={232} y1={cy} x2={cx + r + 6} y2={cy} dash="3 5" o={(v) => eo((v - 0.2) / 0.7)} />
      <MarkRing u={u} cx={cx} cy={cy} r={r} sw={9} />
      <Arc u={u} cx={cx} cy={cy} r={r + 13} sw={3} f={(v) => ip(v, [0.9, 2.6], [0, 1])} />
      <Coin u={u} id="usdc" x={cx - 14} y={cy + 8} />
      <Coin u={u} id="sol" x={cx + 14} y={cy + 12} />
      <Coin u={u} id="btc" x={cx} y={cy - 12} />
      <Lbl u={u} x={258} y={186} t="SAME LIMIT" size={9} anchor="middle" />
      <Lbl u={u} x={24} y={212} t="SAME WAIT" />
    </>
  );
};

// ---------------------------------------------------------------- RECOVERY: twelve words on paper, kept apart from the phone

function Paper({ u, x, y, word }: { u: U; x: number; y: number; word: (i: number) => Fn }) {
  return (
    <>
      <Box x={x} y={y} w={150} h={112} r={12} bg="#17171A" bc="rgba(201,160,87,0.55)" bw={1.2} rot="-2deg" />
      {Array.from({ length: 12 }, (_, i) => {
        const c = i % 4;
        const r = Math.floor(i / 4);
        return (
          <Fade key={i} u={u} o={word(i)}>
            <Box x={x + 16 + c * 31} y={y + 22 + r * 28} w={22} h={6} r={3} bg={GOLD} />
            <Box x={x + 16 + c * 31} y={y + 33 + r * 28} w={14} h={3} r={1.5} bg={C.faint} />
          </Fade>
        );
      })}
    </>
  );
}

const Recovery: Scene = ({ k, u }) => {
  if (k === 0) {
    return (
      <>
        <Phone x={36} y={80} w={50} h={90} />
        <Ln u={u} x1={96} y1={125} x2={116} y2={125} color={C.faint} dash="3 4" />
        <Ln u={u} x1={126} y1={115} x2={136} y2={135} color={C.text} sw={1.6} o={(v) => eo((v - 1.2) / 0.4)} />
        <Ln u={u} x1={136} y1={115} x2={126} y2={135} color={C.text} sw={1.6} o={(v) => eo((v - 1.2) / 0.4)} />
        <Paper u={u} x={160} y={58} word={(i) => (v) => eo((v - 0.2 - i * 0.12) / 0.35)} />
        <Lbl u={u} x={24} y={212} t="KEPT APART" />
      </>
    );
  }
  if (k === 1) {
    const gone = (v: number) => eo((v - 1.9) / 0.5);
    return (
      <>
        <MarkRing u={u} cx={78} cy={110} r={34} sw={7} />
        <Arc u={u} cx={78} cy={110} r={45} sw={3} f={(v) => ip(v, [0, 0.9, 1.9], [0.1, 0.55, 0.55]) * (1 - gone(v))} />
        <Box x={36} y={158} w={84} h={24} r={12} bg="#1D1D20" bc="rgba(201,160,87,0.5)" />
        <Lbl u={u} x={78} y={174} t="WAITING" size={9} ls={1.6} color={C.text} anchor="middle" o={(v) => (v > 1.8 ? 0 : 1)} />
        <Lbl u={u} x={78} y={174} t="CANCELLED" size={9} ls={1.6} color={C.text} anchor="middle" o={(v) => (v > 1.8 ? 1 : 0)} />
        <Paper u={u} x={160} y={58} word={(i) => (v) => 0.55 + 0.45 * Math.max(0, Math.sin(v * 3 - i * 0.2))} />
        <Lbl u={u} x={24} y={212} t="CANCEL WHAT WAITS" />
      </>
    );
  }
  const flow = (i: number, v: number) => eio((v - 0.4 - i * 0.45) / 1.2);
  const ids: LogoId[] = ['bnb', 'trx', 'ltc'];
  const px = (t: number) => lerp(96, 252, t);
  const py = (t: number) => 115 - Math.sin(Math.PI * t) * 34;
  return (
    <>
      <MarkRing u={u} cx={78} cy={115} r={34} sw={7} />
      <Coin u={u} id="bnb" x={70} y={124} size={18} o={0.9} />
      <Coin u={u} id="trx" x={86} y={122} size={18} o={0.9} />
      <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
        <Path d="M100 115 C160 80 210 80 250 115" fill="none" stroke={GOLD} strokeOpacity={0.35} strokeDasharray="2 5" />
      </Svg>
      <At cx={272} cy={115} size={44}><Icon name="shield" size={44} color={GOLD} width={1.4} /></At>
      <Ripple u={u} cx={272} cy={115} r0={26} r1={50} t0={2.3} t1={3.2} />
      {ids.map((id, i) => (
        <View key={id} style={StyleSheet.absoluteFill} pointerEvents="none">
          {[4, 3, 2, 1].map((g) => (
            <Coin key={g} u={u} id={id} size={24} s={trail(g).shrink} x={(v) => px(flow(i, v - trail(g).delay))} y={(v) => py(flow(i, v - trail(g).delay))} o={(v) => (flow(i, v - trail(g).delay) > 0.01 && flow(i, v - trail(g).delay) < 0.99 ? trail(g).fade : 0)} />
          ))}
          <Coin u={u} id={id} size={24} x={(v) => px(flow(i, v))} y={(v) => py(flow(i, v))} o={(v) => (flow(i, v) > 0.01 && flow(i, v) < 0.99 ? 1 : 0)} />
        </View>
      ))}
      <Lbl u={u} x={272} y={160} t="SAFE ADDRESS" size={9} ls={1.6} anchor="middle" />
      <Lbl u={u} x={24} y={212} t="OR MOVE IT SAFE" />
    </>
  );
};

// ---------------------------------------------------------------- APPS WALLET: sites reach only the card

const SITES: [number, number][] = [[44, 64], [44, 115], [44, 166]];

function AppsBase({ children }: { children?: ReactNode }) {
  return (
    <>
      {SITES.map(([x, y]) => (
        <View key={y} pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Box x={x - 18} y={y - 18} w={36} h={36} r={11} bg="#1B1B1E" bc={C.faint} />
          <At cx={x} cy={y} size={20}><Icon name="globe" size={20} color={C.text} width={1.7} /></At>
        </View>
      ))}
      <Box x={176} y={54} w={140} h={88} r={14} bg="#18181B" bc="rgba(201,160,87,0.6)" bw={1.2} />
      <Text style={{ position: 'absolute', left: 190, top: 65, fontFamily: F.semibold, fontSize: 7.5, letterSpacing: 2, color: C.text, opacity: 0.9, includeFontPadding: false }}>APPS WALLET</Text>
      {[0, 1, 2].map((i) => (
        <Spot key={i} cx={197 + i * 30} cy={116} r={12} bg="#0A0A0B" bc="rgba(201,160,87,0.4)" />
      ))}
      <View pointerEvents="none" style={{ position: 'absolute', opacity: 0.5, left: 0, top: 0 }}>
        <Svg width={W} height={H}>
          <Path d="M236 180 A14 14 0 1 0 250 194" fill="none" stroke={C.faint} strokeWidth={4} strokeLinecap="round" />
          <Circle cx={236 + 14 * 0.707} cy={194 - 14 * 0.707} r={3} fill={C.faint} />
        </Svg>
      </View>
      {children}
    </>
  );
}

const Apps: Scene = ({ k, u }) => {
  if (k === 0) {
    return (
      <AppsBase>
        {SITES.map(([x, y], i) => {
          const t = (v: number) => eo((v - 0.3 - i * 0.4) / 0.8);
          return <Ln key={y} u={u} x1={x + 20} y1={y} x2={(v) => lerp(x + 20, 176, t(v))} y2={(v) => lerp(y, 98, t(v))} sw={1.5} o={0.7} />;
        })}
        <Lbl u={u} x={24} y={212} t="SITES CONNECT HERE" />
      </AppsBase>
    );
  }
  if (k === 1) {
    const d = (v: number) => eo((v - 0.5) / 0.7);
    return (
      <AppsBase>
        <Coin u={u} id="sol" size={24} x={197} y={(v) => lerp(10, 116, d(v))} o={(v) => ip(v, [0.5, 0.7], [0, 1])} />
        <Ripple u={u} cx={197} cy={116} r0={12} r1={42} t0={1.15} t1={1.9} />
        <Coin u={u} id="usdc" size={24} x={227} y={116} o={(v) => eo((v - 2.2) / 0.5)} />
        <Coin u={u} id="bnb" size={24} x={257} y={116} o={(v) => eo((v - 2.7) / 0.5)} />
        <Lbl u={u} x={24} y={212} t="ONLY WHAT YOU ADD" />
      </AppsBase>
    );
  }
  const p = (v: number) => eo((v - 0.2) / 1.0);
  const hit = (v: number) => eo((v - 1.5) / 0.8);
  return (
    <AppsBase>
      <Coin u={u} id="sol" size={24} x={197} y={116} />
      <Coin u={u} id="usdc" size={24} x={227} y={116} />
      <Coin u={u} id="bnb" size={24} x={257} y={116} />
      <Ln u={u} x1={196} y1={164} x2={316} y2={164} sw={2} dash="6 5" o={0.85} />
      <At cx={176} cy={164} size={18}><Icon name="shield" size={16} color={GOLD} width={1.8} /></At>
      <Mv u={u} x={(v) => lerp(62, 176, p(v))} y={(v) => lerp(64, 98, p(v))} o={(v) => (p(v) > 0 && p(v) < 1 ? 1 : 0)} size={8}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.text }} />
      </Mv>
      <Mv u={u} x={296} y={72} o={(v) => ip(v, [1.1, 1.4], [0, 1])} size={22}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={13} color="#000" width={2.8} />
        </View>
      </Mv>
      <Mv u={u} x={236} y={(v) => lerp(178, 166, hit(v))} o={(v) => (v > 1.5 && v < 2.3 ? 1 : 0)} size={8}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.text }} />
      </Mv>
      <Ripple u={u} cx={236} cy={164} r0={8} r1={40} t0={2.2} t1={3.3} />
      <Lbl u={u} x={24} y={212} t="SITES STOP HERE" />
    </AppsBase>
  );
};

// ---------------------------------------------------------------- SWAP: two coins meet in a locked ring, then trade places

const Swap: Scene = ({ k, u }) => {
  const cx = 171;
  const cy = 115;
  if (k === 0) {
    const a = (v: number) => eo((v - 0.2) / 0.8);
    return (
      <>
        <Coin u={u} id="eth" x={54} y={cy} size={40} />
        <Coin u={u} id="btc" x={288} y={cy} size={40} />
        <MarkRing u={u} cx={cx} cy={cy} r={30} sw={6} color={GOLD} o={0.45} />
        <Ln u={u} x1={84} y1={cy} x2={(v) => lerp(84, cx - 40, a(v))} y2={cy} dash="3 5" />
        <Ln u={u} x1={258} y1={cy} x2={(v) => lerp(258, cx + 40, a(v))} y2={cy} dash="3 5" />
        <Lbl u={u} x={54} y={168} t="YOU OFFER" size={9} ls={1.8} anchor="middle" o={(v) => eo((v - 0.8) / 0.4)} />
        <Lbl u={u} x={288} y={168} t="YOU ASK" size={9} ls={1.8} anchor="middle" o={(v) => eo((v - 1.1) / 0.4)} />
        <Lbl u={u} x={24} y={212} t="ONE COIN FOR ANOTHER" />
      </>
    );
  }
  if (k === 1) {
    const m = (v: number) => eo((v - 0.2) / 0.9);
    return (
      <>
        <Coin u={u} id="eth" x={(v) => lerp(54, cx - 92, m(v))} y={cy} size={40} />
        <Coin u={u} id="btc" x={(v) => lerp(288, cx + 92, m(v))} y={cy} size={40} />
        <MarkRing u={u} cx={cx} cy={cy} r={36} sw={6} o={0.9} />
        <Arc u={u} cx={cx} cy={cy} r={48} sw={3} f={(v) => ip(v, [1.1, 2.1], [0, 1])} />
        <Lbl u={u} x={cx} y={cy + 5} t="LOCKED" size={10} ls={2} anchor="middle" o={(v) => eo((v - 1.9) / 0.4)} />
        <Lbl u={u} x={24} y={212} t="BOTH SIDES LOCKED" />
      </>
    );
  }
  const tt = (v: number) => eio((v - 0.5) / 1.6);
  return (
    <>
      <MarkRing u={u} cx={cx} cy={cy} r={36} sw={6} dot={false} o={(v) => 0.9 * (1 - eo((v - 2.3) / 0.5)) + 0.15} />
      {[4, 3, 2, 1].map((g) => (
        <View key={g} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Coin u={u} id="eth" size={40} s={1 - g * 0.08} x={(v) => cx - 92 + 184 * tt(v - g * 0.05)} y={(v) => cy - Math.sin(Math.PI * tt(v - g * 0.05)) * 46} o={0.1 + 0.07 * (4 - g)} />
          <Coin u={u} id="btc" size={40} s={1 - g * 0.08} x={(v) => cx + 92 - 184 * tt(v - g * 0.05)} y={(v) => cy + Math.sin(Math.PI * tt(v - g * 0.05)) * 46} o={0.1 + 0.07 * (4 - g)} />
        </View>
      ))}
      <Coin u={u} id="eth" size={40} x={(v) => cx - 92 + 184 * tt(v)} y={(v) => cy - Math.sin(Math.PI * tt(v)) * 46} />
      <Coin u={u} id="btc" size={40} x={(v) => cx + 92 - 184 * tt(v)} y={(v) => cy + Math.sin(Math.PI * tt(v)) * 46} />
      <Mv u={u} x={cx} y={cy} o={(v) => eo((v - 2.2) / 0.4)} size={32}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={18} color="#000" width={2.8} />
        </View>
      </Mv>
      <Lbl u={u} x={24} y={212} t="OR YOUR COIN COMES BACK" />
    </>
  );
};

// ---------------------------------------------------------------- PREDICT: a dial of the crowd's chance, in cents

/** The gold payout block, growing upward from its bottom edge. */
function PayBar({ u, h }: { u: U; h: Fn }) {
  const Hs = useMemo(() => sampled(h), []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ top: 134 - sh(u, Hs), height: sh(u, Hs), opacity: Math.min(1, sh(u, Hs) / 20) }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 196, width: 120, borderRadius: 10, backgroundColor: GOLD }, st]} />;
}

const Predict: Scene = ({ k, u }) => {
  const cx = 171;
  const cy = 130;
  const R = 100;
  if (k === 0) {
    const v = (t: number) => lerp(10, 60, eio((t - 0.2) / 1.5));
    const ang = (val: number) => Math.PI * (1 - val / 100);
    const P = (val: number, r: number): [number, number] => [cx + Math.cos(ang(val)) * r, cy - Math.sin(ang(val)) * r];
    return (
      <>
        {Array.from({ length: 21 }, (_, i) => {
          const val = i * 5;
          const [x1, y1] = P(val, R);
          const [x2, y2] = P(val, R - (i % 2 ? 7 : 13));
          const sw = i % 2 ? 1 : 1.6;
          return (
            <View key={i} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Ln u={u} x1={x1} y1={y1} x2={x2} y2={y2} color="#fff" sw={sw} o={(t) => (v(t) >= val ? 0 : 0.25)} />
              <Ln u={u} x1={x1} y1={y1} x2={x2} y2={y2} color={GOLD} sw={sw} o={(t) => (v(t) >= val ? 1 : 0)} />
            </View>
          );
        })}
        <Ln u={u} x1={(t) => cx + (P(v(t), R - 20)[0] - cx) * 0.12} y1={(t) => cy + (P(v(t), R - 20)[1] - cy) * 0.12} x2={(t) => P(v(t), R - 20)[0]} y2={(t) => P(v(t), R - 20)[1]} color={C.text} sw={2.4} />
        <Spot cx={cx} cy={cy} r={6} bg={C.text} />
        {Array.from({ length: 11 }, (_, i) => {
          const n = 10 + i * 5;
          return (
            <Lbl key={n} u={u} x={cx} y={cy + 30} t={`${n}¢`} size={34} ls={-1} color={C.text} anchor="middle" o={(t) => (v(t) >= n - 2.5 && v(t) < n + 2.5 ? 1 : 0)} />
          );
        })}
        <Lbl u={u} x={cx} y={cy + 46} t="CHANCE OF YES" size={9} ls={2.2} anchor="middle" />
        <Fade u={u} o={(t) => eo((t - 1.8) / 0.4)}>
          <Box x={52} y={192} w={104} h={26} r={13} bg="#17301F" bc="rgba(61,214,140,0.6)" />
          <Box x={166} y={192} w={104} h={26} r={13} bg="#1C1C1F" bc={C.faint} />
          <Lbl u={u} x={104} y={209} t="YES  60¢" size={11} ls={1.4} color={C.good} anchor="middle" />
          <Lbl u={u} x={218} y={209} t="NO  40¢" size={11} ls={1.4} color={C.sub} anchor="middle" />
        </Fade>
      </>
    );
  }
  if (k === 1) {
    const m = (v: number) => eo((v - 0.3) / 0.9);
    const win = (v: number) => eo((v - 1.1) / 0.8);
    return (
      <>
        <Spot cx={62} cy={115} r={26} bc={GOLD} bw={1.5} />
        <Lbl u={u} x={62} y={120} t="60¢" size={13} ls={0} color={C.text} anchor="middle" />
        <Lbl u={u} x={62} y={160} t="YOU PAY" size={9} ls={1.8} anchor="middle" />
        <Ln u={u} x1={96} y1={115} x2={(v) => lerp(96, 150, m(v))} y2={115} dash="3 5" />
        <PayBar u={u} h={(v) => lerp(0, 70, win(v))} />
        <Lbl u={u} x={256} y={112} t="100¢" size={18} ls={0} color="#000" anchor="middle" o={win} />
        <Lbl u={u} x={256} y={158} t="IF YOU ARE RIGHT" size={9} ls={1.6} anchor="middle" o={(v) => eo((v - 1.6) / 0.4)} />
        <Fade u={u} o={(v) => eo((v - 2.2) / 0.4)}>
          <Box x={196} y={176} w={120} h={3} r={1.5} bg={C.faint} />
        </Fade>
        <Lbl u={u} x={256} y={194} t="WRONG PAYS 0" size={9} ls={1.6} color={C.faint} anchor="middle" o={(v) => eo((v - 2.3) / 0.4)} />
      </>
    );
  }
  return (
    <>
      <Spot cx={cx} cy={115} r={62} bc="rgba(255,255,255,0.12)" bw={3} />
      <Arc u={u} cx={cx} cy={115} r={62} sw={4} f={(v) => ip(v, [0.4, 2.6], [0, 1])} />
      <Fade u={u} o={(v) => eo((v - 2.6) / 0.4) * 0.12}>
        <Spot cx={cx} cy={115} r={62} bg={GOLD} />
      </Fade>
      <Lbl u={u} x={cx} y={110} t="DISPUTE WINDOW" size={9.5} ls={1.6} anchor="middle" />
      <Lbl u={u} x={cx} y={130} t="OPEN" size={12} ls={2} color={C.text} anchor="middle" o={(v) => (v > 2.6 ? 0 : 0.95)} />
      <Lbl u={u} x={cx} y={130} t="FINAL" size={12} ls={2} color={C.text} anchor="middle" o={(v) => (v > 2.6 ? 0.95 : 0)} />
    </>
  );
};

export const SCENES: Record<TutorialId, Scene> = { vault: Vault, recovery: Recovery, apps: Apps, swap: Swap, predict: Predict };
